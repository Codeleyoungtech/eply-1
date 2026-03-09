# EPLY — Your AI Self on WhatsApp
> Responds as you. Sounds like you. Never sleeps.

## What is EPLY?
EPLY is not a chatbot. It is YOU on WhatsApp — your voice, your tone, your knowledge, running 24/7 so you never stress about messages again.

## Quick Start

### 1. Install
```bash
npm install
```

### 2. Configure
```bash
cp .env.example .env
# Fill in all values — especially your API keys
```

### 3. Run locally
```bash
node index.js
```

Then visit `http://localhost:3000/qr` and scan the QR code with WhatsApp.

**Important:** Keep `AUTO_REPLY_ENABLED=false` until you're happy with how EPLY sounds. Test on yourself first.

## Dashboard Routes

| Route | Description |
|-------|-------------|
| `/` | Live status, stats, auto-reply toggle |
| `/qr` | QR code to connect WhatsApp |
| `/identity` | Fill your persona — the most important page |
| `/vip` | Manage your VIP list |
| `/flagged` | Messages flagged for your review |
| `/digest` | Daily digest history |
| `/chats` | Full chat monitor |
| `/memory` | Long-term memory browser |
| `/scheduler` | Cron jobs |
| `/settings` | All configuration |
| `/logs` | Live log stream |
| `/health` | JSON health check (Railway uptime) |

## Deploy on Railway

1. Push to a **private** GitHub repo (`.env` must be in `.gitignore`)
2. Railway → New Project → Deploy from GitHub
3. **Add a Volume** → Mount at `/data` → Size: 1 GB *(critical — do this before first deploy)*
4. Add Redis service (Railway auto-injects `REDIS_URL`)
5. Add all env vars from `.env.example` in the Variables tab
6. Deploy → visit `/qr` → scan → done

See `EPLY_PRD_v3.md` for full documentation.

## Tech Stack
- **WhatsApp**: `@whiskeysockets/baileys`
- **Dashboard**: Express.js + EJS
- **LLMs**: Groq (Llama 3.3 70B) · Gemini 2.0 Flash · Claude Sonnet
- **DB**: better-sqlite3 (SQLite)
- **Queue**: BullMQ + Redis
- **Logging**: Winston + SSE live stream
- **Deploy**: Railway
