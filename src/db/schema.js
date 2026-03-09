'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { logger } = require('../logger');

let db;

function getDb() {
    if (!db) throw new Error('Database not initialized — call initDb() first');
    return db;
}

function initDb() {
    const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'eply.db');

    // Ensure parent directory exists (e.g. /data on Railway)
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
    -- ── Identity Profile ───────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS identity (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      full_name   TEXT,
      nickname    TEXT,
      location    TEXT,
      timezone    TEXT,
      what_i_do   TEXT,
      vibe        TEXT,
      real_examples TEXT,
      schedule    TEXT,
      projects    TEXT,
      interests   TEXT,
      off_limits  TEXT,
      reply_length TEXT DEFAULT 'short',
      emoji_use   TEXT DEFAULT 'occasional',
      slang       TEXT,
      never_say   TEXT,
      punctuation TEXT,
      updated_at  INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- Seed the identity row once so we always have exactly one
    INSERT OR IGNORE INTO identity (id) VALUES (1);

    -- ── VIP List ────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS vip_list (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      phone       TEXT NOT NULL UNIQUE,
      label       TEXT,
      added_at    INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- ── Messages (every message in/out) ─────────────────────────────────────
    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      jid         TEXT NOT NULL,        -- chat JID (phone@s.whatsapp.net or group@g.us)
      contact_name TEXT,
      direction   TEXT NOT NULL,        -- 'in' | 'out'
      content     TEXT,
      media_type  TEXT,                 -- null | 'image' | 'audio' | 'document' | 'video'
      llm_used    TEXT,                 -- 'groq' | 'gemini' | 'claude' | null
      is_group    INTEGER DEFAULT 0,
      timestamp   INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_jid ON messages (jid);
    CREATE INDEX IF NOT EXISTS idx_messages_ts  ON messages (timestamp);

    -- ── Flagged Messages ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS flagged (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      jid         TEXT NOT NULL,
      contact_name TEXT,
      their_msg   TEXT,
      eply_reply  TEXT,
      reason      TEXT,
      handled     INTEGER DEFAULT 0,
      created_at  INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- ── Daily Digests ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS digests (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      content     TEXT NOT NULL,
      stats       TEXT,                 -- JSON blob
      delivered   INTEGER DEFAULT 0,
      created_at  INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- ── Long-term Memory ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS memory (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      jid         TEXT NOT NULL,
      contact_name TEXT,
      fact        TEXT NOT NULL,
      source_msg  TEXT,
      created_at  INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_jid ON memory (jid);

    -- ── Scheduler Jobs ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS scheduler_jobs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      cron_expr   TEXT,
      payload     TEXT,                 -- JSON
      enabled     INTEGER DEFAULT 1,
      last_run    INTEGER,
      created_at  INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- ── Settings Key-Value ──────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS settings (
      key         TEXT PRIMARY KEY,
      value       TEXT,
      updated_at  INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- Seed defaults
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('auto_reply_enabled', 'false'),
      ('default_model',      'auto'),
      ('notify_method',      'self_chat'),
      ('digest_time',        '07:00'),
      ('digest_timezone',    'Africa/Johannesburg'),
      ('urgency_keywords',   '["urgent","emergency","asap","call me","sos","please","i need help","are you okay","please respond"]'),
      ('log_level',          'info');
  `);

    logger.info('Database initialised', { path: dbPath });
    return db;
}

module.exports = { initDb, getDb };
