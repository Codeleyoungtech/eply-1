'use strict';

/**
 * Built-in Command Handler
 * These commands work INSTANTLY without any LLM — no API keys needed.
 * They are processed BEFORE the LLM router and always reply.
 *
 * Commands:
 *   !ping        — latency test
 *   !help        — list all commands
 *   !menu        — categorized command menu
 *   !status      — bot status
 *   !id          — show your JID (useful for config)
 *   !off         — disable auto-reply (only for admin)
 *   !on          — enable auto-reply (only for admin)
 *   !whoami      — show admin number
 *   !summary     — summarize recent group messages (admin only)
 *   !groupmode   — enable/disable group features (admin only)
 */

const { logger } = require('../logger');
const db = require('../db/queries');
const { runTextTool, runThreadTool } = require('./groupTools');

const COMMANDS = new Map([
    ['!ping',   handlePing],
    ['ping',    handlePing],
    ['!help',   handleHelp],
    ['!menu',   handleMenu],
    ['menu',    handleMenu],
    ['!status', handleStatus],
    ['!id',     handleId],
    ['!on',     handleOn],
    ['!off',    handleOff],
    ['!whoami', handleWhoami],
    ['!summary', handleSummary],
    ['!recap',   handleSummary],
    ['!catchup', handleCatchup],
    ['!todo', handleTodo],
    ['!tasks', handleTodo],
    ['!task', handleTodo],
    ['!decisions', handleDecisions],
    ['!decision', handleDecisions],
    ['!ask', handleAsk],
    ['!remember', handleRemember],
    ['!recall', handleRecall],
    ['!find', handleRecall],
    ['!rewrite', handleRewrite],
    ['!polish', handlePolish],
    ['!translate', handleTranslate],
    ['!shorten', handleShorten],
    ['!mute', handleMute],
    ['!unmute', handleUnmute],
    ['!groupmode', handleGroupMode],
    ['!storegroups', handleStoreGroups],
    ['!storegroup', handleStoreGroups],
]);

function isCommand(text) {
    if (!text) return false;
    const first = text.trim().toLowerCase().split(/\s+/)[0];
    return COMMANDS.has(first);
}

async function runCommand({ text, jid, isAdmin, isGroup, quotedText }) {
    const first = text.trim().toLowerCase().split(/\s+/)[0];
    const handler = COMMANDS.get(first);
    if (!handler) return null;
    logger.info('Built-in command triggered', { cmd: first, jid });
    return handler({ text, jid, isAdmin, isGroup, quotedText });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

function handlePing({ jid }) {
    const ts = Date.now();
    return `🏓 *pong* — EPLY is alive (${ts % 10000}ms reference)`;
}

function handleHelp() {
    return handleMenu();
}

function handleMenu() {
    return [
        '⚡ *EPLY Menu*',
        '',
        '*Core*',
        '`!status` — bot status',
        '`!ping` — check if alive',
        '`!id` — show this chat ID',
        '`!whoami` — show admin number',
        '`!on` / `!off` — auto-reply switch',
        '',
        '*Chat Intelligence*',
        'Voice notes — transcribe and reply automatically',
        '`!summary` / `!recap` — summarize recent chat',
        '`!catchup` — show what needs attention',
        '`!todo` / `!task` — extract tasks from recent chat',
        '`!decisions` / `!decision` — extract decisions/open questions',
        '',
        '*Text Tools*',
        '`!ask <question>` — quick answer',
        '`!remember <fact>` — save private memory',
        '`!recall <query>` — search private memory',
        '`!rewrite <text>` — rewrite text',
        '`!polish <text>` — clean up text',
        '`!translate <lang> <text>` — translate text',
        '`!shorten <text>` — make text shorter',
        '',
        '*Control*',
        '`!mute` / `!unmute` — silence or allow this chat',
        '`!groupmode on|off` — toggle group features (admin only)',
        '`!storegroups on|off` — store group messages for summaries (admin only)',
        '',
        '*Group Trigger*',
        'Tag your number or type `@eply` in a group.',
        '',
        '_EPLY — your AI self on WhatsApp_',
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

async function handleSummary({ text, jid, isAdmin, isGroup }) {
    if (!isAdmin) return '❌ Only the admin can summarize chats.';
    if (isGroup && db.getSetting('group_summary_enabled') !== 'true') return 'Group summaries are currently disabled.';
    if (isGroup && db.getSetting('store_group_messages') !== 'true') {
        return 'Group message storage is off. Send `!storegroups on`, let the group chat for a bit, then use `!summary`.';
    }
    return runThreadTool({ jid, text, tool: 'summary', isGroup });
}

async function handleCatchup({ text, jid, isAdmin, isGroup }) {
    if (!isAdmin) return '❌ Only the admin can use catch-up.';
    if (isGroup && db.getSetting('store_group_messages') !== 'true') {
        return 'Group message storage is off. Send `!storegroups on`, let the group chat for a bit, then use `!catchup`.';
    }
    return runThreadTool({ jid, text, tool: 'catchup', isGroup });
}

async function handleTodo({ text, jid, isAdmin, isGroup }) {
    if (!isAdmin) return '❌ Only the admin can extract tasks.';
    if (isGroup && db.getSetting('store_group_messages') !== 'true') {
        return 'Group message storage is off. Send `!storegroups on`, let the group chat for a bit, then use `!todo`.';
    }
    return runThreadTool({ jid, text, tool: 'todo', isGroup });
}

async function handleDecisions({ text, jid, isAdmin, isGroup }) {
    if (!isAdmin) return '❌ Only the admin can extract decisions.';
    if (isGroup && db.getSetting('store_group_messages') !== 'true') {
        return 'Group message storage is off. Send `!storegroups on`, let the group chat for a bit, then use `!decisions`.';
    }
    return runThreadTool({ jid, text, tool: 'decisions', isGroup });
}

function parseOnOff(text) {
    const value = String(text || '').trim().toLowerCase().split(/\s+/)[1];
    if (['on', 'true', 'yes', '1'].includes(value)) return 'true';
    if (['off', 'false', 'no', '0'].includes(value)) return 'false';
    return null;
}

function handleGroupMode({ text, isAdmin }) {
    if (!isAdmin) return '❌ Only the admin can change group mode.';
    const value = parseOnOff(text);
    if (!value) return 'Usage: `!groupmode on` or `!groupmode off`';
    db.setSetting('group_features_enabled', value);
    return value === 'true'
        ? '🟢 Group features enabled. I can respond when tagged/replied to and run group tools.'
        : '🔴 Group features disabled. I will stay quiet in groups except basic commands.';
}

function handleStoreGroups({ text, isAdmin }) {
    if (!isAdmin) return '❌ Only the admin can change group storage.';
    const value = parseOnOff(text);
    if (!value) return 'Usage: `!storegroups on` or `!storegroups off`';
    db.setSetting('store_group_messages', value);
    return value === 'true'
        ? '🟢 Group message storage enabled for summaries and context.'
        : '🔴 Group message storage disabled.';
}

async function handleAsk({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use utility tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'ask' }) || 'Usage: `!ask your question` or reply `!ask what does this mean?` to a message';
}

function stripCommandText(text, quotedText = '') {
    const direct = String(text || '').replace(/^!\w+\s*/i, '').trim();
    return direct || String(quotedText || '').trim();
}

function handleRemember({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can save private memory.';
    const fact = stripCommandText(text, quotedText);
    if (!fact) return 'Usage: `!remember the thing you want me to keep`';
    db.saveFact({
        jid: 'private-brain',
        contactName: 'Private Brain',
        fact,
        sourceMsg: `Saved from ${jid}`,
    });
    return 'Saved to private memory.';
}

function handleRecall({ text, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can search private memory.';
    const query = stripCommandText(text, quotedText);
    if (!query) return 'Usage: `!recall what you want to find`';
    const rows = db.searchMemories(query, 6);
    if (!rows.length) return 'No matching memory found.';
    return [
        '*Memory matches*',
        ...rows.map((row, index) => `${index + 1}. ${row.fact}`),
    ].join('\n');
}

function textWithQuotedFallback(text, quotedText) {
    const command = String(text || '').split(/\s+/)[0] || '';
    const payload = stripCommandText(text);
    if (payload) return text;
    if (!quotedText) return text;
    return `${command} ${quotedText}`;
}

async function handleRewrite({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use utility tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'rewrite' }) || 'Usage: `!rewrite your text` or reply `!rewrite` to a message';
}

async function handlePolish({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use utility tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'polish' }) || 'Usage: `!polish your text` or reply `!polish` to a message';
}

async function handleTranslate({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use utility tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'translate' }) || 'Usage: `!translate French your text` or reply `!translate French` to a message';
}

async function handleShorten({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use utility tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'short' }) || 'Usage: `!shorten your text` or reply `!shorten` to a message';
}

function handleMute({ jid, isAdmin }) {
    if (!isAdmin) return '❌ Only the admin can mute chats.';
    db.saveContactProfile({ jid, muted: 1 });
    return '🔕 This chat is now muted. I will not auto-reply here.';
}

function handleUnmute({ jid, isAdmin }) {
    if (!isAdmin) return '❌ Only the admin can unmute chats.';
    db.saveContactProfile({ jid, muted: 0 });
    return '🔔 This chat is unmuted.';
}

module.exports = { isCommand, runCommand };
