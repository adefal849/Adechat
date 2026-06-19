// ══════════════════════════════════════════════════════════
//  ADÉCHAT — Backend Node.js + Express
//  npm install, puis : node server.js
// ══════════════════════════════════════════════════════════

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const axios      = require('axios');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── MIDDLEWARE ──
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // PayDunya envoie son callback IPN en x-www-form-urlencoded
app.use(express.static('../')); // Sert les fichiers frontend

// ══════════════════════════════════════
//  BASE DE DONNÉES (en mémoire pour dev)
//  → Remplacez par Firebase ou Supabase en prod
// ══════════════════════════════════════
let db = { orders: [], clients: [], invoices: [], messages: [], faqs: [] };

// ══════════════════════════════════════
//  ABONNEMENT — Plan & quota (1 seule boutique par déploiement)
//  → Pour gérer plusieurs marchands sur un seul serveur, il faudrait
//    ajouter un système de comptes (un "shop" par utilisateur connecté).
// ══════════════════════════════════════
const PLAN_PRICES = { premium: 2000, business: 5000 }; // FCFA / mois
const PLAN_LIMITS = {
  free:     { maxAiReplies: 100,      autoRelance: false, aiSummary: false },
  premium:  { maxAiReplies: Infinity, autoRelance: true,  aiSummary: true  },
  business: { maxAiReplies: Infinity, autoRelance: true,  aiSummary: true  }
};

db.shop = {
  plan: 'free',          // free | premium | business
  aiRepliesUsed: 0,
  monthKey: monthKey(),
  quotaWarned: false,    // pour n'envoyer qu'UN seul message d'upsell par mois, jamais plus
  proSince: null
};
db.payments = []; // { token, plan, amount, status, date }

function monthKey(d = new Date()) { return `${d.getFullYear()}-${d.getMonth() + 1}`; }
function ensureMonthly() {
  const mk = monthKey();
  if (db.shop.monthKey !== mk) {
    db.shop.monthKey = mk;
    db.shop.aiRepliesUsed = 0;
    db.shop.quotaWarned = false;
  }
}
function planLimits() { return PLAN_LIMITS[db.shop.plan] || PLAN_LIMITS.free; }

// ── FIREBASE (décommentez pour activer) ──
/*
const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const firestore = admin.firestore();

async function dbGet(collection) {
  const snap = await firestore.collection(collection).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function dbPut(collection, id, data) {
  await firestore.collection(collection).doc(id).set(data, { merge: true });
}
*/

// ══════════════════════════════════════
//  WHATSAPP BUSINESS API
// ══════════════════════════════════════
const WA_TOKEN    = process.env.WA_ACCESS_TOKEN;
const WA_PHONE_ID = process.env.WA_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || 'adechat_verify_2025';
const GEMINI_KEY  = process.env.GEMINI_API_KEY;
const GROQ_KEY    = process.env.GROQ_API_KEY;
const GROQ_MODEL  = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// ── PayDunya (paiement) ──
const PD_MASTER  = process.env.PAYDUNYA_MASTER_KEY;
const PD_PRIVATE = process.env.PAYDUNYA_PRIVATE_KEY;
const PD_PUBLIC  = process.env.PAYDUNYA_PUBLIC_KEY;
const PD_TOKEN   = process.env.PAYDUNYA_TOKEN;
const PD_MODE    = process.env.PAYDUNYA_MODE === 'live' ? 'live' : 'test';
const PD_BASE    = PD_MODE === 'live'
  ? 'https://app.paydunya.com/api/v1'
  : 'https://app.paydunya.com/sandbox-api/v1';
const PD_CONFIGURED = !!(PD_MASTER && PD_PRIVATE && PD_TOKEN);

function paydunyaHeaders() {
  return {
    'Content-Type': 'application/json',
    'PAYDUNYA-MASTER-KEY': PD_MASTER,
    'PAYDUNYA-PRIVATE-KEY': PD_PRIVATE,
    'PAYDUNYA-PUBLIC-KEY': PD_PUBLIC,
    'PAYDUNYA-TOKEN': PD_TOKEN
  };
}

// ── Vérification du webhook Meta ──
app.get('/api/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook WhatsApp vérifié');
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Token invalide');
  }
});

// ── Réception des messages WhatsApp ──
app.post('/api/webhook', async (req, res) => {
  res.sendStatus(200); // Répondre immédiatement à Meta

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    const entry   = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;

    if (!value?.messages?.length) return;

    const msg   = value.messages[0];
    const from  = msg.from;
    const text  = msg.text?.body || '';
    const msgId = msg.id;

    console.log(`📩 Message de ${from}: "${text}"`);

    // Enregistrer le message
    db.messages.push({ id: msgId, from, text, date: new Date().toISOString(), replied: false });

    // Générer et envoyer la réponse IA (limitée selon le plan — voir ensureMonthly/planLimits)
    ensureMonthly();
    const limits = planLimits();
    let reply = null;

    if (db.shop.aiRepliesUsed < limits.maxAiReplies) {
      reply = await generateAIReply(text, from);
      if (reply) db.shop.aiRepliesUsed++;
    } else if (!db.shop.quotaWarned) {
      // Un seul message discret pour tout le mois — on n'embête jamais le client plus d'une fois
      reply = "Merci pour votre message 🙏 Notre assistant automatique a atteint sa limite mensuelle gratuite. Un membre de l'équipe va vous répondre directement très vite.";
      db.shop.quotaWarned = true;
    }

    if (reply) {
      await sendWhatsAppMessage(from, reply);
      db.messages[db.messages.length - 1].replied = true;
      db.messages[db.messages.length - 1].reply = reply;
    }

    // Détecter une commande (mots-clés)
    const orderKeywords = ['commande', 'acheter', 'commander', 'je prends', 'je veux', 'prix', 'disponible'];
    const isOrder = orderKeywords.some(k => text.toLowerCase().includes(k));

    if (isOrder) {
      const client = db.clients.find(c => c.phone === from) || { name: `Client ${from.slice(-4)}`, phone: from };
      const order = {
        id: 'CMD-' + Date.now(),
        clientId: client.id || 'auto',
        clientName: client.name,
        items: text.substring(0, 100),
        amount: 0,
        status: 'pending',
        payment: 'unpaid',
        source: 'whatsapp',
        date: new Date().toISOString()
      };
      db.orders.push(order);
      console.log(`📦 Commande auto-créée : ${order.id}`);
    }

  } catch (err) {
    console.error('❌ Erreur webhook:', err.message);
  }
});

// ── Envoyer un message WhatsApp ──
async function sendWhatsAppMessage(to, text) {
  if (!WA_TOKEN || !WA_PHONE_ID) {
    console.warn('⚠️ WhatsApp API non configurée (WA_ACCESS_TOKEN ou WA_PHONE_NUMBER_ID manquant)');
    return;
  }
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`,
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
      { headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    console.log(`✅ Message envoyé à ${to}`);
  } catch (err) {
    console.error('❌ Erreur envoi WhatsApp:', err.response?.data || err.message);
  }
}

// ── Appel Groq (rapide, gratuit, prioritaire si clé fournie) ──
async function callGroq(prompt) {
  const r = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens: 300
    },
    { headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' } }
  );
  return r.data.choices?.[0]?.message?.content?.trim() || null;
}

// ── Appel Gemini (repli si pas de clé Groq ou si Groq échoue) ──
async function callGemini(prompt) {
  const r = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
    { contents: [{ parts: [{ text: prompt }] }] },
    { headers: { 'Content-Type': 'application/json' } }
  );
  return r.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

// ── Générer une réponse IA (Groq → Gemini → rien) ──
async function generateAIReply(question, from) {
  // 1. Chercher dans les FAQs d'abord
  const faqMatch = db.faqs.find(f =>
    question.toLowerCase().includes(f.q.toLowerCase().split(' ').slice(0, 2).join(' '))
  );
  if (faqMatch) return faqMatch.a;

  // 2. Appeler le fournisseur IA configuré
  if (!GROQ_KEY && !GEMINI_KEY) return null;

  const shopContext = process.env.SHOP_CONTEXT || 'Boutique générale en Afrique de l\'Ouest.';
  const prompt = `Tu es l'assistant IA d'une boutique WhatsApp. ${shopContext}\n\nFAQs : ${db.faqs.map(f=>`Q:${f.q} → R:${f.a}`).join(' | ')}\n\nMessage client : "${question}"\n\nRéponds de façon courte (max 3 phrases), amicale, en français. Si c'est une commande, confirme-la.`;

  try {
    if (GROQ_KEY) return await callGroq(prompt);
    return await callGemini(prompt);
  } catch (err) {
    console.error('❌ Erreur IA (Groq):', err.response?.data || err.message);
    if (GROQ_KEY && GEMINI_KEY) {
      try { return await callGemini(prompt); } catch (err2) {
        console.error('❌ Erreur IA (Gemini, fallback):', err2.response?.data || err2.message);
      }
    }
    return null;
  }
}

// ══════════════════════════════════════
//  API REST — Commandes
// ══════════════════════════════════════
app.get('/api/orders', (req, res) => {
  const { status, payment } = req.query;
  let orders = db.orders;
  if (status)  orders = orders.filter(o => o.status  === status);
  if (payment) orders = orders.filter(o => o.payment === payment);
  res.json({ success: true, data: orders.sort((a,b) => new Date(b.date) - new Date(a.date)) });
});

app.post('/api/orders', (req, res) => {
  const { clientName, items, amount, status = 'pending', payment = 'unpaid', note } = req.body;
  if (!items || !amount) return res.status(400).json({ error: 'items et amount requis' });
  const order = { id: 'CMD-' + Date.now(), clientName: clientName || 'Inconnu', items, amount, status, payment, note, date: new Date().toISOString() };
  db.orders.push(order);
  res.json({ success: true, data: order });
});

app.patch('/api/orders/:id', (req, res) => {
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  Object.assign(order, req.body);
  res.json({ success: true, data: order });
});

app.delete('/api/orders/:id', (req, res) => {
  db.orders = db.orders.filter(o => o.id !== req.params.id);
  res.json({ success: true });
});

// ══════════════════════════════════════
//  API REST — Clients
// ══════════════════════════════════════
app.get('/api/clients', (req, res) => res.json({ success: true, data: db.clients }));

app.post('/api/clients', (req, res) => {
  const { name, phone, city, country } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name et phone requis' });
  const exists = db.clients.find(c => c.phone === phone);
  if (exists) return res.status(409).json({ error: 'Client déjà enregistré', data: exists });
  const client = { id: 'CLI-' + Date.now(), name, phone, city, country, date: new Date().toISOString() };
  db.clients.push(client);
  res.json({ success: true, data: client });
});

app.delete('/api/clients/:id', (req, res) => {
  db.clients = db.clients.filter(c => c.id !== req.params.id);
  res.json({ success: true });
});

// ══════════════════════════════════════
//  API REST — Factures
// ══════════════════════════════════════
app.get('/api/invoices', (req, res) => res.json({ success: true, data: db.invoices }));

app.post('/api/invoices', (req, res) => {
  const { clientName, lines, total, date } = req.body;
  const invoice = {
    id: 'FAC-' + String(db.invoices.length + 1).padStart(4, '0'),
    clientName, lines, total, date: date || new Date().toISOString().split('T')[0],
    status: 'sent', createdAt: new Date().toISOString()
  };
  db.invoices.push(invoice);
  res.json({ success: true, data: invoice });
});

// ══════════════════════════════════════
//  API REST — FAQ & IA
// ══════════════════════════════════════
app.get('/api/faqs', (req, res) => res.json({ success: true, data: db.faqs }));

app.post('/api/faqs', (req, res) => {
  const { q, a } = req.body;
  if (!q || !a) return res.status(400).json({ error: 'q et a requis' });
  const faq = { id: 'FAQ-' + Date.now(), q, a };
  db.faqs.push(faq);
  res.json({ success: true, data: faq });
});

app.delete('/api/faqs/:id', (req, res) => {
  db.faqs = db.faqs.filter(f => f.id !== req.params.id);
  res.json({ success: true });
});

// ── Test IA depuis le backend (évite CORS) ──
app.post('/api/ai/test', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'question requise' });
  const reply = await generateAIReply(question, 'test');
  res.json({ success: true, reply: reply || 'Aucune réponse générée.' });
});

// ── Envoyer une relance WhatsApp ──
app.post('/api/send-relance', async (req, res) => {
  const { phone, clientName, amount, currency = 'FCFA' } = req.body;
  const msg = `Bonjour ${clientName} ! 👋 Votre commande d'un montant de ${amount} ${currency} est en attente de paiement. Merci de régulariser pour confirmer votre livraison. Nous restons disponibles pour tout renseignement. 🙏`;
  await sendWhatsAppMessage(phone, msg);
  res.json({ success: true, message: 'Relance envoyée' });
});

// ── Stats du jour ──
app.get('/api/stats/today', (req, res) => {
  const today = new Date().toDateString();
  const todayOrders = db.orders.filter(o => new Date(o.date).toDateString() === today);
  res.json({
    success: true,
    data: {
      orders:    todayOrders.length,
      sales:     todayOrders.filter(o => o.payment === 'paid').reduce((s,o) => s + o.amount, 0),
      messages:  db.messages.filter(m => new Date(m.date).toDateString() === today).length,
      newClients: db.clients.filter(c => new Date(c.date).toDateString() === today).length
    }
  });
});

// ══════════════════════════════════════
//  ABONNEMENT — Plan actuel & quota
// ══════════════════════════════════════
app.get('/api/plan', (req, res) => {
  ensureMonthly();
  const limits = planLimits();
  res.json({
    success: true,
    data: {
      plan: db.shop.plan,
      aiRepliesUsed: db.shop.aiRepliesUsed,
      aiRepliesLimit: limits.maxAiReplies === Infinity ? null : limits.maxAiReplies,
      autoRelance: limits.autoRelance,
      aiSummary: limits.aiSummary,
      proSince: db.shop.proSince,
      paydunyaReady: PD_CONFIGURED
    }
  });
});

// ══════════════════════════════════════
//  RÉSUMÉ IA HEBDOMADAIRE (Premium / Business)
//  Le frontend envoie les stats qu'il affiche déjà (cohérence avec le tableau de bord),
//  le serveur se contente d'appeler l'IA avec sa clé secrète.
// ══════════════════════════════════════
app.post('/api/ai/summary', async (req, res) => {
  if (!planLimits().aiSummary) {
    return res.status(403).json({ error: 'Le résumé IA est réservé aux plans Premium et Business.' });
  }
  if (!GROQ_KEY && !GEMINI_KEY) {
    return res.status(503).json({ error: 'Aucune clé IA configurée côté serveur (GROQ_API_KEY ou GEMINI_API_KEY).' });
  }
  const { orders = 0, sales = 0, unpaid = 0, newClients = 0, currency = 'FCFA' } = req.body;
  const prompt = `Tu es analyste business pour une petite boutique WhatsApp en Afrique de l'Ouest. Chiffres de la semaine : ${orders} commandes, ${sales} ${currency} de ventes encaissées, ${unpaid} commandes impayées, ${newClients} nouveaux clients. Rédige un résumé de 4 phrases maximum en français, ton motivant mais factuel, avec UN conseil concret et actionnable pour la semaine prochaine.`;
  try {
    const summary = GROQ_KEY ? await callGroq(prompt) : await callGemini(prompt);
    res.json({ success: true, data: { summary: summary || "Pas assez de données pour un résumé pertinent cette semaine." } });
  } catch (err) {
    console.error('❌ Erreur résumé IA:', err.response?.data || err.message);
    res.status(502).json({ error: "Impossible de générer le résumé pour l'instant." });
  }
});

// ══════════════════════════════════════
//  RELANCES AUTOMATIQUES (Premium / Business)
//  Toutes les 6h, relance une fois chaque commande impayée depuis +48h.
// ══════════════════════════════════════
async function autoRelanceCheck() {
  if (!planLimits().autoRelance) return;
  const cutoff = Date.now() - 48 * 3600 * 1000;
  for (const o of db.orders) {
    if (o.payment !== 'paid' && !o.relanceSent && new Date(o.date).getTime() < cutoff) {
      const client = db.clients.find(c => c.name === o.clientName);
      if (client?.phone) {
        await sendWhatsAppMessage(client.phone, `Bonjour ${o.clientName} ! 👋 Votre commande ${o.id} (${o.amount} FCFA) est toujours en attente de paiement. Répondez à ce message pour régulariser. 🙏`);
        o.relanceSent = true;
        console.log(`🔔 Relance auto envoyée pour ${o.id}`);
      }
    }
  }
}
setInterval(autoRelanceCheck, 6 * 3600 * 1000);

// ══════════════════════════════════════
//  PAIEMENT — PayDunya (Mobile Money, Orange Money, Wave, carte)
// ══════════════════════════════════════

// ── Créer une facture de paiement pour passer Premium/Business ──
app.post('/api/payment/create-invoice', async (req, res) => {
  const { plan } = req.body;
  if (!['premium', 'business'].includes(plan)) {
    return res.status(400).json({ error: "Le champ 'plan' doit être 'premium' ou 'business'." });
  }
  if (!PD_CONFIGURED) {
    return res.status(503).json({ error: 'PayDunya non configuré côté serveur. Renseignez PAYDUNYA_MASTER_KEY, PAYDUNYA_PRIVATE_KEY et PAYDUNYA_TOKEN dans .env.' });
  }

  const amount = PLAN_PRICES[plan];
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  // BACKEND_URL = l'adresse publique DE CE SERVEUR (ex: Render). Indispensable si le
  // frontend (Netlify) et le backend sont hébergés sur deux domaines différents,
  // sinon PayDunya enverrait sa confirmation de paiement vers Netlify (qui n'a pas cette route → échec).
  const backendUrl = (process.env.BACKEND_URL || frontendUrl).replace(/\/$/, '');

  try {
    const payload = {
      invoice: {
        total_amount: amount,
        description: `Abonnement Adéchat — Plan ${plan} (1 mois)`
      },
      store: {
        name: process.env.SHOP_NAME || 'Adéchat',
        tagline: 'Automatisez votre boutique WhatsApp'
      },
      custom_data: { plan },
      actions: {
        callback_url: `${backendUrl}/api/payment/webhook`,
        return_url: `${frontendUrl}/dashboard.html?payment=success`,
        cancel_url: `${frontendUrl}/dashboard.html?payment=cancel`
      }
    };
    const r = await axios.post(`${PD_BASE}/checkout-invoice/create`, payload, { headers: paydunyaHeaders() });

    if (r.data.response_code === '00') {
      db.payments.push({ token: r.data.token, plan, amount, status: 'pending', date: new Date().toISOString() });
      res.json({ success: true, checkout_url: r.data.response_text, token: r.data.token });
    } else {
      res.status(502).json({ error: r.data.response_text || 'Erreur PayDunya inconnue.' });
    }
  } catch (err) {
    console.error('❌ Erreur PayDunya create-invoice:', err.response?.data || err.message);
    res.status(502).json({ error: 'Impossible de contacter PayDunya pour le moment.' });
  }
});

async function confirmPaydunyaToken(token) {
  const r = await axios.get(`${PD_BASE}/checkout-invoice/confirm/${token}`, { headers: paydunyaHeaders() });
  return r.data;
}

function activatePlanFromPayment(payment) {
  payment.status = 'completed';
  db.shop.plan = payment.plan;
  db.shop.proSince = new Date().toISOString();
  console.log(`💰 Paiement confirmé — Plan "${payment.plan}" activé`);
}

// ── Callback IPN PayDunya (appelé par leurs serveurs, pas par le navigateur) ──
app.post('/api/payment/webhook', async (req, res) => {
  res.sendStatus(200); // accuser réception immédiatement, comme exigé par PayDunya
  try {
    const raw = req.body?.data ? JSON.parse(req.body.data) : req.body;
    const token = raw?.invoice?.token || raw?.token;
    if (!token) return;

    const data = await confirmPaydunyaToken(token); // on ne fait JAMAIS confiance au callback seul, on revérifie
    const status = data?.status || (data?.response_code === '00' ? 'completed' : 'pending');
    const payment = db.payments.find(p => p.token === token);
    if (payment && status === 'completed' && payment.status !== 'completed') {
      activatePlanFromPayment(payment);
    }
  } catch (err) {
    console.error('❌ Erreur webhook PayDunya:', err.response?.data || err.message);
  }
});

// ── Vérification depuis le frontend après redirection (return_url) ──
app.get('/api/payment/status/:token', async (req, res) => {
  if (!PD_CONFIGURED) return res.status(503).json({ error: 'PayDunya non configuré.' });
  try {
    const data = await confirmPaydunyaToken(req.params.token);
    const status = data?.status || (data?.response_code === '00' ? 'completed' : 'pending');
    const payment = db.payments.find(p => p.token === req.params.token);
    if (payment && status === 'completed' && payment.status !== 'completed') {
      activatePlanFromPayment(payment);
    }
    res.json({ success: true, status, plan: db.shop.plan });
  } catch (err) {
    console.error('❌ Erreur vérification paiement:', err.response?.data || err.message);
    res.status(502).json({ error: 'Impossible de vérifier le paiement pour le moment.' });
  }
});


// ── Health check ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok', version: '1.1.0',
    wa: !!(WA_TOKEN && WA_PHONE_ID),
    ai: !!(GROQ_KEY || GEMINI_KEY),
    aiProvider: GROQ_KEY ? 'groq' : (GEMINI_KEY ? 'gemini' : null),
    payment: PD_CONFIGURED,
    plan: db.shop.plan,
    uptime: process.uptime()
  });
});

// ── Démarrage ──
app.listen(PORT, () => {
  console.log(`\n🚀 Adéchat Backend démarré sur http://localhost:${PORT}`);
  console.log(`   WhatsApp API : ${WA_TOKEN ? '✅ Configuré' : '⚠️  Non configuré (WA_ACCESS_TOKEN manquant)'}`);
  console.log(`   IA           : ${GROQ_KEY ? '✅ Groq (' + GROQ_MODEL + ')' : (GEMINI_KEY ? '✅ Gemini (fallback)' : '⚠️  Non configurée')}`);
  console.log(`   PayDunya     : ${PD_CONFIGURED ? `✅ Configuré (mode ${PD_MODE})` : '⚠️  Non configuré (clés PAYDUNYA_* manquantes)'}`);
  console.log(`   Webhook URL  : POST http://votre-domaine.com/api/webhook\n`);
});

module.exports = app;
