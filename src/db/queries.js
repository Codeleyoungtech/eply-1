'use strict';

const { getDb } = require('./schema');

// ── Identity ─────────────────────────────────────────────────────────────────

function getIdentity() {
    return getDb().prepare('SELECT * FROM identity WHERE id = 1').get() || {};
}

function saveIdentity(fields) {
    const allowed = [
        'full_name', 'nickname', 'location', 'timezone', 'what_i_do', 'vibe',
        'real_examples', 'schedule', 'projects', 'interests', 'off_limits',
        'reply_length', 'emoji_use', 'slang', 'never_say', 'punctuation',
    ];
    const cols = allowed.filter(k => k in fields);
    if (!cols.length) return;
    const set = cols.map(c => `${c} = ?`).join(', ');
    const vals = cols.map(c => fields[c]);
    vals.push(Math.floor(Date.now() / 1000));
    getDb().prepare(`UPDATE identity SET ${set}, updated_at = ? WHERE id = 1`).run(...vals);
}

// ── VIP List ─────────────────────────────────────────────────────────────────

function getVips() {
    return getDb().prepare('SELECT * FROM vip_list ORDER BY added_at DESC').all();
}

function isVip(phone, jid = '') {
    const normalized = String(phone || '').replace(/[^0-9]/g, '');
    const normalizedJid = String(jid || '').trim().toLowerCase();

    const candidates = new Set([
        normalized,
        normalized.slice(-10),
        normalized.slice(-11),
        normalizedJid,
    ].filter(Boolean));

    const rows = getDb().prepare('SELECT phone FROM vip_list').all();
    return rows.some(({ phone: storedPhone }) => {
        const rawStored = String(storedPhone || '').trim();
        const storedJid = rawStored.toLowerCase();
        const stored = rawStored.replace(/[^0-9]/g, '');
        return (
            candidates.has(storedJid) ||
            (stored && (candidates.has(stored) || candidates.has(stored.slice(-10)) || candidates.has(stored.slice(-11))))
        );
    });
}

function addVip(identifier, label) {
    const raw = String(identifier || '').trim();
    if (!raw) return null;
    const normalized = raw.includes('@') ? raw.toLowerCase() : raw.replace(/[^0-9]/g, '');
    return getDb()
        .prepare('INSERT OR IGNORE INTO vip_list (phone, label) VALUES (?, ?)')
        .run(normalized, label || '');
}

function removeVip(id) {
    return getDb().prepare('DELETE FROM vip_list WHERE id = ?').run(id);
}

// ── Messages ─────────────────────────────────────────────────────────────────

function saveMessage({ jid, contactName, direction, content, mediaType, llmUsed, isGroup }) {
    return getDb()
        .prepare(`INSERT INTO messages (jid, contact_name, direction, content, media_type, llm_used, is_group)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(jid, contactName || null, direction, content || '', mediaType || null, llmUsed || null, isGroup ? 1 : 0);
}

function getThread(jid, limit = 30) {
    return getDb()
        .prepare('SELECT * FROM messages WHERE jid = ? ORDER BY timestamp DESC LIMIT ?')
        .all(jid, limit)
        .reverse();
}

function deleteMessagesByIds(ids = []) {
    const validIds = ids.map((id) => Number(id)).filter(Number.isInteger);
    if (!validIds.length) return { changes: 0 };

    return getDb()
        .prepare(`DELETE FROM messages WHERE id IN (${validIds.map(() => '?').join(',')})`)
        .run(...validIds);
}

function deleteMessagesByJid(jid) {
    return getDb().prepare('DELETE FROM messages WHERE jid = ?').run(jid);
}

function getAllChats() {
    return getDb().prepare(`
    SELECT jid, contact_name, MAX(timestamp) as last_ts, COUNT(*) as total,
           SUM(CASE WHEN direction='out' THEN 1 ELSE 0 END) as replied
    FROM messages GROUP BY jid ORDER BY last_ts DESC
  `).all();
}

function getTodayStats() {
    const dayStart = Math.floor(Date.now() / 1000) - 86400;
    return getDb().prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN direction='out' THEN 1 ELSE 0 END) as replies_sent,
      SUM(CASE WHEN llm_used='groq'   THEN 1 ELSE 0 END) as groq_count,
      SUM(CASE WHEN llm_used='gemini' THEN 1 ELSE 0 END) as gemini_count,
      SUM(CASE WHEN llm_used='claude' THEN 1 ELSE 0 END) as claude_count
    FROM messages WHERE timestamp > ?
  `).get(dayStart);
}

function recordLlmUsage({ jid, provider, model, estimatedInput = 0, estimatedOutput = 0, estimatedTotal = 0 }) {
    return getDb()
        .prepare(`INSERT INTO llm_usage (jid, provider, model, estimated_input, estimated_output, estimated_total)
              VALUES (?, ?, ?, ?, ?, ?)`)
        .run(jid || null, provider, model || null, estimatedInput, estimatedOutput, estimatedTotal);
}

function getTodayLlmUsage() {
    const dayStart = Math.floor(Date.now() / 1000) - 86400;
    return getDb().prepare(`
    SELECT
      COUNT(*) as calls,
      COALESCE(SUM(estimated_input), 0) as estimated_input,
      COALESCE(SUM(estimated_output), 0) as estimated_output,
      COALESCE(SUM(estimated_total), 0) as estimated_total
    FROM llm_usage WHERE created_at > ?
  `).get(dayStart);
}

// ── Flagged ───────────────────────────────────────────────────────────────────

function flagMessage({ jid, contactName, theirMsg, eplyReply, reason }) {
    return getDb()
        .prepare(`INSERT INTO flagged (jid, contact_name, their_msg, eply_reply, reason)
              VALUES (?, ?, ?, ?, ?)`)
        .run(jid, contactName || null, theirMsg || '', eplyReply || '', reason || '');
}

function getFlagged(includeHandled = false) {
    const where = includeHandled ? '' : 'WHERE handled = 0';
    return getDb().prepare(`SELECT * FROM flagged ${where} ORDER BY created_at DESC`).all();
}

function markHandled(id) {
    return getDb().prepare('UPDATE flagged SET handled = 1 WHERE id = ?').run(id);
}

// ── Digests ───────────────────────────────────────────────────────────────────

function saveDigest(content, stats) {
    return getDb()
        .prepare('INSERT INTO digests (content, stats) VALUES (?, ?)')
        .run(content, JSON.stringify(stats || {}));
}

function getDigests(limit = 30) {
    return getDb().prepare('SELECT * FROM digests ORDER BY created_at DESC LIMIT ?').all(limit);
}

function markDigestDelivered(id) {
    return getDb().prepare('UPDATE digests SET delivered = 1 WHERE id = ?').run(id);
}

// ── Memory ────────────────────────────────────────────────────────────────────

function saveFact({ jid, contactName, fact, sourceMsg }) {
    return getDb()
        .prepare('INSERT INTO memory (jid, contact_name, fact, source_msg) VALUES (?, ?, ?, ?)')
        .run(jid, contactName || null, fact, sourceMsg || null);
}

function getMemories(jid) {
    return getDb()
        .prepare('SELECT * FROM memory WHERE jid = ? ORDER BY created_at DESC')
        .all(jid);
}

function getAllMemories() {
    return getDb().prepare('SELECT * FROM memory ORDER BY created_at DESC').all();
}

function deleteFact(id) {
    return getDb().prepare('DELETE FROM memory WHERE id = ?').run(id);
}

function updateFact(id, fact) {
    return getDb().prepare('UPDATE memory SET fact = ? WHERE id = ?').run(fact, id);
}

// ── Contact Profiles ─────────────────────────────────────────────────────────

function getContactProfile(jid) {
    return getDb().prepare('SELECT * FROM contact_profiles WHERE jid = ?').get(jid) || null;
}

function saveContactProfile({ jid, displayName, tonePreference, respectfulTitles, wittyAllowed, muted }) {
    if (!jid) return null;

    const existing = getContactProfile(jid) || {};
    const payload = {
        displayName: displayName !== undefined ? displayName : existing.display_name || null,
        tonePreference: tonePreference !== undefined ? tonePreference : existing.tone_preference || 'auto',
        respectfulTitles: respectfulTitles !== undefined ? respectfulTitles : (existing.respectful_titles ?? 1),
        wittyAllowed: wittyAllowed !== undefined ? wittyAllowed : (existing.witty_allowed ?? 0),
        muted: muted !== undefined ? muted : (existing.muted ?? 0),
    };

    return getDb()
        .prepare(`INSERT INTO contact_profiles (jid, display_name, tone_preference, respectful_titles, witty_allowed, muted, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(jid) DO UPDATE SET
                display_name = excluded.display_name,
                tone_preference = excluded.tone_preference,
                respectful_titles = excluded.respectful_titles,
                witty_allowed = excluded.witty_allowed,
                muted = excluded.muted,
                updated_at = excluded.updated_at`)
        .run(
            jid,
            payload.displayName,
            payload.tonePreference,
            payload.respectfulTitles ? 1 : 0,
            payload.wittyAllowed ? 1 : 0,
            payload.muted ? 1 : 0,
            Math.floor(Date.now() / 1000)
        );
}

// ── Settings ──────────────────────────────────────────────────────────────────

function getSetting(key) {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
}

function setSetting(key, value) {
    return getDb()
        .prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
        .run(key, value, Math.floor(Date.now() / 1000));
}

function getAllSettings() {
    const rows = getDb().prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// ── Scheduler Jobs ────────────────────────────────────────────────────────────

function getJobs() {
    return getDb().prepare('SELECT * FROM scheduler_jobs ORDER BY created_at DESC').all();
}

function createJob({ name, cronExpr, payload }) {
    return getDb()
        .prepare('INSERT INTO scheduler_jobs (name, cron_expr, payload) VALUES (?, ?, ?)')
        .run(name, cronExpr || null, payload ? JSON.stringify(payload) : null);
}

function deleteJob(id) {
    return getDb().prepare('DELETE FROM scheduler_jobs WHERE id = ?').run(id);
}

function touchJob(id) {
    return getDb()
        .prepare('UPDATE scheduler_jobs SET last_run = ? WHERE id = ?')
        .run(Math.floor(Date.now() / 1000), id);
}

module.exports = {
    getIdentity, saveIdentity,
    getVips, isVip, addVip, removeVip,
    saveMessage, getThread, getAllChats, getTodayStats, deleteMessagesByIds, deleteMessagesByJid,
    recordLlmUsage, getTodayLlmUsage,
    flagMessage, getFlagged, markHandled,
    saveDigest, getDigests, markDigestDelivered,
    saveFact, getMemories, getAllMemories, deleteFact, updateFact,
    getContactProfile, saveContactProfile,
    getSetting, setSetting, getAllSettings,
    getJobs, createJob, deleteJob, touchJob,
};
