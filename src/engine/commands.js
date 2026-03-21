'use strict';

/**
 * Built-in Command Handler
 * These commands work INSTANTLY without any LLM — no API keys needed.
 * They are processed BEFORE the LLM router and always reply.
 *
 * Commands:
 *   !ping        — latency test
 *   !help        — list all commands
 *   !status      — bot status
 *   !id          — show your JID (useful for config)
 *   !off         — disable auto-reply (only for admin)
 *   !on          — enable auto-reply (only for admin)
 *   !whoami      — show admin number
 */

const { logger } = require('../logger');
const db = require('../db/queries');

const COMMANDS = new Map([
    ['!ping',   handlePing],
    ['ping',    handlePing],
    ['!help',   handleHelp],
    ['!status', handleStatus],
    ['!id',     handleId],
    ['!on',     handleOn],
    ['!off',    handleOff],
    ['!whoami', handleWhoami],
]);

function isCommand(text) {
    if (!text) return false;
    const first = text.trim().toLowerCase().split(/\s+/)[0];
    return COMMANDS.has(first);
}

async function runCommand({ text, jid, isAdmin }) {
    const first = text.trim().toLowerCase().split(/\s+/)[0];
    const handler = COMMANDS.get(first);
    if (!handler) return null;
    logger.info('Built-in command triggered', { cmd: first, jid });
    return handler({ jid, isAdmin });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

function handlePing({ jid }) {
    const ts = Date.now();
    return `🏓 *pong* — EPLY is alive (${ts % 10000}ms reference)`;
}

function handleHelp() {
    return [
        '⚡ *EPLY Commands*',
        '',
        '`!ping`   — check if the bot is alive',
        '`!status` — show current bot status',
        '`!id`     — show your WhatsApp ID',
        '`!on`     — enable auto-replies (admin only)',
        '`!off`    — disable auto-replies (admin only)',
        '`!whoami` — show admin number',
        '',
        '_EPLY — your AI self on WhatsApp 🤖_',
    ].join('\n');
}

function handleStatus() {
    const autoReply = process.env.AUTO_REPLY_ENABLED === 'true';
    const hasGroq    = !!process.env.GROQ_API_KEY;
    const hasGemini  = !!process.env.GEMINI_API_KEY;
    const hasClaude  = !!process.env.ANTHROPIC_API_KEY;
    const uptime = Math.floor(process.uptime());
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = uptime % 60;

    return [
        '📊 *EPLY Status*',
        '',
        `Auto-reply: ${autoReply ? '🟢 ON' : '🔴 OFF'}`,
        `Uptime: ${h}h ${m}m ${s}s`,
        '',
        '*LLM Keys*',
        `Groq:   ${hasGroq    ? '✅' : '❌ missing'}`,
        `Gemini: ${hasGemini  ? '✅' : '❌ missing'}`,
        `Claude: ${hasClaude  ? '✅' : '❌ missing'}`,
    ].join('\n');
}

function handleId({ jid }) {
    return `🆔 Your JID: \`${jid}\``;
}

function handleOn({ isAdmin }) {
    if (!isAdmin) return '❌ Only the admin can enable auto-reply';
    process.env.AUTO_REPLY_ENABLED = 'true';
    db.setSetting('auto_reply_enabled', 'true');
    return '🟢 Auto-reply *enabled*. EPLY will now reply to messages.';
}

function handleOff({ isAdmin }) {
    if (!isAdmin) return '❌ Only the admin can disable auto-reply';
    process.env.AUTO_REPLY_ENABLED = 'false';
    db.setSetting('auto_reply_enabled', 'false');
    return '🔴 Auto-reply *disabled*. EPLY is now silent.';
}

function handleWhoami() {
    return `👤 Admin number: \`${process.env.ADMIN_NUMBER || '(not set)'}\``;
}

module.exports = { isCommand, runCommand };
