'use strict';

/**
 * Digest Builder — assembles and delivers the daily digest.
 * Based on PRD §4.1 sample digest format.
 */

const { getDb } = require('../db/schema');
const { saveDigest, markDigestDelivered, getTodayStats, getFlagged, getVips } = require('../db/queries');
const { sendDigest } = require('./notifier');
const { logger } = require('../logger');

async function buildAndSendDigest() {
    logger.info('Building daily digest...');

    const now = new Date();
    const dayLabel = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    const dayStart = Math.floor(Date.now() / 1000) - 86400;

    const db = getDb();

    // ── DMs handled ──────────────────────────────────────────────────────────
    const dmReplies = db.prepare(`
    SELECT jid, contact_name, content, llm_used, timestamp
    FROM messages WHERE direction='out' AND is_group=0 AND timestamp > ?
    ORDER BY timestamp DESC
  `).all(dayStart);

    // ── Group replies sent ────────────────────────────────────────────────────
    const groupReplies = db.prepare(`
    SELECT jid, contact_name, content, timestamp
    FROM messages WHERE direction='out' AND is_group=1 AND timestamp > ?
    ORDER BY timestamp DESC
  `).all(dayStart);

    // ── VIP messages received ─────────────────────────────────────────────────
    const vipMsgs = db.prepare(`
    SELECT jid, contact_name, content, timestamp
    FROM messages WHERE direction='in' AND timestamp > ?
  `).all(dayStart);
    const vips = getVips().map(v => v.phone);
    const vipReceived = vipMsgs.filter(m => vips.some(v => m.jid.includes(v)));

    // ── Flagged ───────────────────────────────────────────────────────────────
    const flagged = getFlagged(false); // unhandled only

    // ── Stats ─────────────────────────────────────────────────────────────────
    const stats = getTodayStats();

    // ── Build digest text ─────────────────────────────────────────────────────
    const sep = '─'.repeat(44);
    let lines = [];
    lines.push(`☀️  EPLY DAILY DIGEST  —  ${dayLabel}`);
    lines.push(sep);

    // DMs section
    lines.push(`\n📩  DMs HANDLED  (${dmReplies.length} replies sent)`);
    for (const r of dmReplies.slice(0, 10)) {
        const name = r.contact_name || r.jid.split('@')[0];
        lines.push(`→  ${name}: ${(r.content || '').slice(0, 80)}`);
    }
    if (dmReplies.length > 10) lines.push(`→  ... ${dmReplies.length - 10} more`);

    // VIP section
    if (vipReceived.length > 0) {
        lines.push(`\n👑  VIP MESSAGES  (${vipReceived.length} — NOT auto-replied)`);
        for (const v of vipReceived) {
            const name = v.contact_name || v.jid.split('@')[0];
            lines.push(`→  ${name} [VIP]: ${(v.content || '').slice(0, 80)}`);
        }
    }

    // Flagged section
    if (flagged.length > 0) {
        lines.push(`\n⚠️  FLAGGED FOR YOU  (${flagged.length} items — action needed)`);
        for (const f of flagged.slice(0, 5)) {
            const name = f.contact_name || f.jid.split('@')[0];
            lines.push(`→  ${name}: ${(f.their_msg || '').slice(0, 80)}`);
            lines.push(`   Reason: ${f.reason}  |  EPLY said: "${(f.eply_reply || '').slice(0, 60)}"`);
        }
    }

    // Group section
    if (groupReplies.length > 0) {
        lines.push(`\n💬  GROUP CHAT TRIGGERS  (${groupReplies.length} replies sent)`);
        for (const g of groupReplies.slice(0, 5)) {
            const name = g.contact_name || g.jid.split('@')[0];
            lines.push(`→  ${name}: ${(g.content || '').slice(0, 80)}`);
        }
    }

    // Stats
    lines.push(`\n📊  STATS`);
    lines.push(`   Total handled: ${stats?.total || 0}  |  Flagged: ${flagged.length}  |  VIP msgs: ${vipReceived.length}`);
    lines.push(`   Groq: ${stats?.groq_count || 0}  |  Gemini: ${stats?.gemini_count || 0}  |  Claude: ${stats?.claude_count || 0}`);

    const digestText = lines.join('\n');

    // Save to DB
    const result = saveDigest(digestText, {
        dm_replies: dmReplies.length,
        group_replies: groupReplies.length,
        flagged: flagged.length,
        vip_received: vipReceived.length,
        stats,
    });

    // Deliver
    try {
        await sendDigest(digestText);
        if (result.lastInsertRowid) markDigestDelivered(result.lastInsertRowid);
        logger.info('Daily digest delivered');
    } catch (err) {
        logger.error('Failed to deliver daily digest', { err: err.message });
    }
}

module.exports = { buildAndSendDigest };
