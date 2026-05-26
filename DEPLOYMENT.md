# EPLY Deployment Guide

## 🚀 Option 1: VPS Deployment (Recommended)
Best for stability and control.

### 1. Prerequisites
- A VPS running Ubuntu/Debian/CentOS.
- Node.js (v22+) and pnpm installed.
- FFmpeg and Python3 installed (for video downloads).

### 2. Setup
```bash
# Clone the repository
git clone <your-repo-url>
cd eply

# Install dependencies
pnpm install

# Setup environment
cp .env.example .env
nano .env # Fill in your API keys (GEMINI_API_KEY is required for image/memory)

# Install PM2 globally
npm install -g pm2

# Start EPLY
pm2 start ecosystem.config.js

# Setup PM2 to start on boot
pm2 startup
pm2 save
```

### 3. Connect WhatsApp
- Visit `http://<your-vps-ip>:3000/qr` in your browser.
- Link your WhatsApp via the QR code.

---

## ☁️ Option 2: Railway Deployment
Easiest setup, fully automated.

### 1. Connect Repo
- Push your code to GitHub.
- Create a New Project on Railway from your GitHub repo.

### 2. Configure Variables
Add these in the **Variables** tab on Railway:
- `GEMINI_API_KEY`: (Get from Google AI Studio)
- `ADMIN_NUMBER`: Your WhatsApp number in international format (e.g., `23480...`)
- `AUTO_REPLY_ENABLED`: `true`

### 3. Setup Persistent Volume (CRITICAL)
Railway containers are ephemeral. Without a volume, you will lose your session and DB every time you deploy.
- Go to **Settings** -> **Volumes**.
- Create a Volume.
- Mount it to `/app/temp`.
- Ensure your `railway.json` or `nixpacks.toml` is used for the build.

---

## 🛠 Maintenance
- **Logs:** Use `pm2 logs eply` (VPS) or the Railway logs tab.
- **Updates:** `git pull && pnpm install && pm2 restart eply`.
- **Database:** Your data is stored in `temp/database.sqlite`. Back it up periodically.
