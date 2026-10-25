# AuroMind — Conscious Casual Gaming Portal

AuroMind is a centralized web portal hosting contemplative, intergenerational casual games (*Vak*, *AuroMatch*, *AuroBlocks*, and *The Witness Mind*).

---

## 📁 Directory Layout

```text
AuroMind/
├── index.html                   ◄── Master Portal Homepage
├── manifest.json                ◄── PWA App Manifest
├── assets/
│   ├── css/portal.css           ◄── Responsive Even-Column Theme (Desktop 4-col, Tablet 2-col, Mobile 1-col)
│   ├── js/portal.js             ◄── Live Search, Category Filters & 432 Hz Ambient Audio
│   ├── icons/                   ◄── Vector SVG Logos (Vak, AuroMatch, AuroBlocks, Logic)
│   └── thumbnails/              ◄── 16:9 Landscape Game Banners
```

---

## 🚀 How to Deploy on GitHub Pages (2 Minutes)

1. **Create a new repository on GitHub**:
   * Repository Name: `AuroMind`
   * Visibility: **Public**

2. **Initialize Git & Push inside this folder**:
   ```bash
   cd AuroMind
   git init
   git add .
   git commit -m "Initial commit: AuroMind Portal with Vak and AuroMatch"
   git branch -M main
   git remote add origin https://github.com/<your-username>/AuroMind.git
   git push -u origin main
   ```

3. **Enable GitHub Pages**:
   * Go to **Settings** ➔ **Pages** in your `AuroMind` repository.
   * Under **Build and deployment**, select:
     * Source: **Deploy from a branch**
     * Branch: **`main`** / **`/ (root)`**
   * Click **Save**.

Your portal will be live at:
`https://<your-username>.github.io/AuroMind/`

---

## 🔮 Future Architecture Roadmap

* **Phase 2 (Cloud Accounts)**: Connect free Supabase Auth (Google & Email Login) for cross-device progress sync.
* **Phase 3 (Monetization)**: Gate premium game packs or full 350-level unlocks with Stripe / Razorpay Webhooks.
* **Phase 4 (Sanctuary Garden)**: Shared cross-game garden meta-progression where clearing levels in any game awards blossoms.
