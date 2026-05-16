'use strict';

/**
 * Database layer — uses Node.js built-in `node:sqlite` (DatabaseSync).
 * Available unflagged from Node 22.12.0+.
 * Zero native compilation — no better-sqlite3, no node-gyp, no Python.
 * API is identical to better-sqlite3: .prepare().get() / .all() / .run()
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { logger } = require('../logger');
const { ensureDir, getDbPath } = require('../config/paths');

let db;

function getDb() {
    if (!db) throw new Error('Database not initialized — call initDb() first');
    return db;
}

function initDb() {
    const dbPath = getDbPath();

    ensureDir(path.dirname(dbPath));

    db = new DatabaseSync(dbPath);

    // WAL mode = faster writes, safe concurrent reads
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');

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
      jid         TEXT NOT NULL,
      contact_name TEXT,
      direction   TEXT NOT NULL,
      content     TEXT,
      media_type  TEXT,
      llm_used    TEXT,
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
      stats       TEXT,
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

    -- ── Contact Profiles ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS contact_profiles (
      jid               TEXT PRIMARY KEY,
      display_name      TEXT,
      chat_mode         TEXT DEFAULT 'auto',
      tone_preference   TEXT DEFAULT 'auto',
      respectful_titles INTEGER DEFAULT 1,
      witty_allowed     INTEGER DEFAULT 0,
      muted             INTEGER DEFAULT 0,
      updated_at        INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- ── LLM Usage Metrics ───────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS llm_usage (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      jid              TEXT,
      provider         TEXT NOT NULL,
      model            TEXT,
      estimated_input  INTEGER DEFAULT 0,
      estimated_output INTEGER DEFAULT 0,
      estimated_total  INTEGER DEFAULT 0,
      created_at       INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_llm_usage_ts ON llm_usage (created_at);

    -- ── Scheduler Jobs ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS scheduler_jobs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      cron_expr   TEXT,
      payload     TEXT,
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
      ('log_level',          'info'),
      ('daily_reply_limit',  '80'),
      ('daily_estimated_token_limit', '12000'),
      ('store_group_messages', 'false'),
      ('group_features_enabled', 'true'),
      ('group_mention_replies', 'true'),
      ('group_reply_to_me_replies', 'true'),
      ('group_summary_enabled', 'true'),
      ('group_summary_default_limit', '40'),
      ('reply_style_guard',  'true');
  `);

    for (const statement of [
        "ALTER TABLE contact_profiles ADD COLUMN chat_mode TEXT DEFAULT 'auto'",
    ]) {
        try {
            db.exec(statement);
        } catch (err) {
            if (!String(err.message || '').includes('duplicate column name')) {
                throw err;
            }
        }
    }

    logger.info('Database initialised', { path: dbPath });
    return db;
}

module.exports = { initDb, getDb };
