# Adéchat 🚀
**Automatisez votre boutique WhatsApp — Pour les marchands d'Afrique de l'Ouest**

---

## 📁 Structure du projet

```
adechat/
├── index.html          ← Landing page marketing
├── dashboard.html      ← Application tableau de bord
├── manifest.json       ← Config PWA (icône, thème)
├── sw.js               ← Service Worker (mode hors ligne)
├── icon-192.png        ← Icône app (à générer)
├── icon-512.png        ← Icône app grande (à générer)
└── backend/
    ├── server.js       ← Serveur Node.js + Express
    ├── package.json    ← Dépendances Node
    └── .env.example    ← Template variables d'environnement
```

---

## ⚡ Démarrage rapide (Frontend seul)

Ouvrez simplement `index.html` dans un navigateur, ou déployez sur :
- **Netlify** : glissez-déposez le dossier sur netlify.com
- **Vercel** : `vercel deploy`
- **GitHub Pages** : activez dans les settings du repo

Le dashboard fonctionne **entièrement hors ligne** grâce à IndexedDB et au Service Worker.

---

## 🔧 Démarrage du backend

```bash
cd backend
cp .env.example .env
# Remplissez .env avec vos clés API
npm install
npm start
# → Serveur sur http://localhost:3000
```

---

## 🔑 Intégrations à configurer

### 1. WhatsApp Business Cloud API
1. Créez un compte sur [developers.facebook.com](https://developers.facebook.com)
2. Créez une application → ajoutez le produit **WhatsApp**
3. Récupérez :
   - `Phone Number ID`
   - `Access Token` (temporaire ou permanent)
4. Configurez le webhook :
   - URL : `https://votre-domaine.com/api/webhook`
   - Verify Token : celui de votre `.env`
   - Champs à souscrire : `messages`

### 2. Gemini AI (Gratuit)
1. Allez sur [aistudio.google.com](https://aistudio.google.com)
2. Cliquez **Get API Key**
3. Copiez la clé dans `.env` → `GEMINI_API_KEY`

### 3. Firebase (Base de données en production)
1. Créez un projet sur [console.firebase.google.com](https://console.firebase.google.com)
2. Activez **Firestore Database**
3. Générez une clé de service (`Paramètres → Comptes de service`)
4. Remplissez les variables `FIREBASE_*` dans `.env`
5. Décommentez le bloc Firebase dans `backend/server.js`

---

## 💰 INTÉGRER DES PUBLICITÉS (Google AdSense)

### Étape 1 — S'inscrire
1. Allez sur [adsense.google.com](https://adsense.google.com)
2. Inscrivez-vous avec votre compte Google
3. Soumettez votre site pour validation (2 à 14 jours)
4. Récupérez votre **Publisher ID** : `ca-pub-XXXXXXXX`

### Étape 2 — Ajouter le script
Dans `<head>` de `index.html` et `dashboard.html`, décommentez :
```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXX" crossorigin="anonymous"></script>
```

### Étape 3 — Placer les blocs publicitaires

#### Sur la landing page (index.html) — meilleurs emplacements :

**Entre trust bar et features (bannière 728x90) :**
```html
<div style="display:flex;justify-content:center;padding:20px 0;">
  <ins class="adsbygoogle"
       style="display:inline-block;width:728px;height:90px"
       data-ad-client="ca-pub-XXXXXXXX"
       data-ad-slot="XXXXXXXXXX"></ins>
  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
</div>
```

**Entre features et pricing (responsive) :**
```html
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-XXXXXXXX"
     data-ad-slot="XXXXXXXXXX"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
```

#### Sur le dashboard — avec discrétion :
**Pied de sidebar (ne pas surcharger l'UX) :**
```html
<ins class="adsbygoogle"
     style="display:block;width:220px;height:90px"
     data-ad-client="ca-pub-XXXXXXXX"
     data-ad-slot="XXXXXXXXXX"></ins>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
```

### ⚠️ Règles AdSense importantes
- Maximum **3 blocs** par page
- Ne mettez **jamais** d'ads sur les pages de connexion
- Respectez les [politiques Google](https://support.google.com/adsense/answer/48182)
- Les revenus arrivent une fois **10 $ atteints** (environ 6 000 FCFA)

### Alternative — Meta Audience Network
Plus pertinent pour l'Afrique de l'Ouest. Inscrivez-vous sur [audiencenetwork.facebook.com](https://audiencenetwork.facebook.com)

---

## 📱 Générer les icônes PWA

Utilisez [realfavicongenerator.net](https://realfavicongenerator.net) avec votre logo SVG pour générer :
- `icon-192.png` (192×192 px)
- `icon-512.png` (512×512 px)

Placez-les à la racine du projet.

---

## 🚀 Déploiement Netlify (recommandé)

```bash
# Option 1 — via CLI
npm install -g netlify-cli
netlify deploy --prod --dir .

# Option 2 — glissez le dossier sur app.netlify.com/drop
```

Pour le backend, déployez sur **Railway** ou **Render** (gratuit) :
```bash
# Sur Railway : connectez votre repo GitHub et ajoutez les env vars
# URL générée → mettez-la comme FRONTEND_URL dans .env
```

---

## 💳 Modèle de revenus

| Plan     | Prix       | Limite            |
|----------|------------|-------------------|
| Gratuit  | 0 FCFA     | 100 messages/mois |
| Premium  | 2 000 FCFA | Messages illimités |
| Business | 5 000 FCFA | Multi-numéros + API |

**Avec 100 clients Premium → 200 000 FCFA/mois**
**Avec 1 000 clients Premium → 2 000 000 FCFA/mois**

---

## 🛠 Stack technique

| Couche    | Technologie                    |
|-----------|-------------------------------|
| Frontend  | HTML + CSS + Vanilla JS       |
| PWA       | Service Worker + IndexedDB    |
| Backend   | Node.js + Express             |
| Base de données | Firebase Firestore (prod) / In-memory (dev) |
| IA        | Google Gemini 1.5 Flash (gratuit) |
| WhatsApp  | Meta Business Cloud API       |
| Paiement  | Wave CI / Orange Money (à intégrer) |

---

*Adéchat — Conçu pour les marchands africains qui utilisent WhatsApp comme boutique.* 🌍
