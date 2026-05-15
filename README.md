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

## Group Chat Features

EPLY can stay quiet in group chats until it is needed.

| Trigger / Command | Description |
|-------------------|-------------|
| `!menu` | Show the command menu |
| Tag your WhatsApp number | EPLY replies in the group when mentioned |
| Reply to one of your messages | EPLY can respond inside that group thread |
| Voice note | EPLY transcribes it, stores the transcript, and replies normally |
| `!summary` or `!recap` | Summarize recent group messages |
| `!catchup` | Explain what you missed and what needs attention |
| `!todo` / `!tasks` | Extract action items from recent chat |
| `!decisions` | Extract decisions and open questions |
| `!summary 80` | Summarize up to 80 recent stored messages |
| `!ask <question>` | Ask a private utility question from WhatsApp |
| `!remember <fact>` | Save something to private memory |
| `!recall <query>` | Search private memory |
| `!rewrite <text>` | Rewrite text |
| `!polish <text>` | Clean up text |
| `!translate <lang> <text>` | Translate text |
| `!shorten <text>` | Make text shorter |
| `!mute` / `!unmute` | Silence or allow auto-replies in the current chat |
| `!groupmode on/off` | Toggle group features from WhatsApp |
| `!storegroups on/off` | Toggle group message storage for summaries |

Group replies trigger when your WhatsApp number is tagged or when the message contains `@eply`. You can change the alias with `EPLY_TRIGGER_NAME`. Group summaries, catch-up, tasks, and decisions require `store_group_messages=true` because EPLY needs saved group history to analyze. Mention replies do not require group history storage.

## Deploy on Railway

1. Push to a **private** GitHub repo (`.env` must be in `.gitignore`)
2. Railway → New Project → Deploy from GitHub
3. **Add a Volume** → Mount at `/data` → Size: 1 GB *(critical — do this before first deploy)*
4. Add Redis service (Railway auto-injects `REDIS_URL`)
5. Add all env vars from `.env.example` in the Variables tab and set `DATA_DIR=/data`
6. Deploy → visit `/qr` → scan → done

## Deploy on InterServer / cPanel Node.js

1. Create a Node.js app that runs `node index.js` from this project directory.
2. Use Node.js 22 or newer. EPLY uses the built-in `node:sqlite` module.
3. Set environment variables from `.env.example`.
4. Keep `DATA_DIR=./data` unless InterServer gives you a better persistent path.
5. Make sure `data/` is writable by the Node.js app user.
6. Open the app URL, log in, visit `/qr`, and scan the WhatsApp QR.

The SQLite database, WhatsApp auth session, dashboard sessions, and logs are stored under `DATA_DIR` by default, so backups and migrations only need that directory plus your environment variables.

See `EPLY_PRD_v3.md` for full documentation.

## Tech Stack
- **WhatsApp**: `@whiskeysockets/baileys`
- **Dashboard**: Express.js + EJS
- **LLMs**: Groq (Llama 3.3 70B) · Gemini 2.0 Flash · Claude Sonnet
- **DB**: Node.js built-in SQLite (`node:sqlite`)
- **Queue**: BullMQ + Redis
- **Logging**: Winston + SSE live stream
- **Deploy**: Railway
