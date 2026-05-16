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
const { parseDueAt, stripReminderCommand } = require('./timeParser');

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
    ['!about', handleAbout],
    ['!history', handleAbout],
    ['!ocr', handleMediaHint],
    ['!receipt', handleMediaHint],
    ['!ui', handleMediaHint],
    ['!contract', handleMediaHint],
    ['!todo', handleTodo],
    ['!tasks', handleTodo],
    ['!task', handleTodo],
    ['!decisions', handleDecisions],
    ['!decision', handleDecisions],
    ['!ask', handleAsk],
    ['!remind', handleRemind],
    ['!reminder', handleRemind],
    ['!followup', handleRemind],
    ['!follow-up', handleRemind],
    ['!reminders', handleReminders],
    ['!remember', handleRemember],
    ['!remeber', handleRemember],
    ['!rember', handleRemember],
    ['!save', handleRemember],
    ['!note', handleRemember],
    ['!recall', handleRecall],
    ['!find', handleRecall],
    ['!search', handleRecall],
    ['!brain', handleBrain],
    ['!dump', handleBrain],
    ['!explain', handleExplain],
    ['!draft', handleDraft],
    ['!post', handlePost],
    ['!thread', handleThread],
    ['!caption', handleCaption],
    ['!script', handleScript],
    ['!portfolio', handlePortfolio],
    ['!stack', handleStack],
    ['!projects', handleProjects],
    ['!hireme', handleHireMe],
    ['!faq', handleFaq],
    ['!rewrite', handleRewrite],
    ['!polish', handlePolish],
    ['!formal', handleFormal],
    ['!casual', handleCasual],
    ['!translate', handleTranslate],
    ['!shorten', handleShorten],
    ['!short', handleShorten],
    ['!bullets', handleBullets],
    ['!bullet', handleBullets],
    ['!mute', handleMute],
    ['!unmute', handleUnmute],
    ['!mode', handleMode],
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
        '⚡ *EPLY Command Center*',
        '_Your AI self, WhatsApp tools, and private Life OS._',
        '',
        '━━ *1. Core* ━━',
        '`!ping` — check if EPLY is alive',
        '`!status` — bot, uptime, and model keys',
        '`!id` — show this chat ID',
        '`!whoami` — show admin number',
        '`!on` / `!off` — enable or pause auto-replies',
        '',
        '━━ *2. Chat Intelligence* ━━',
        'Voice notes — transcribed and answered automatically',
        'Images/PDFs — understood when media mode is enabled',
        '`!ocr`, `!receipt`, `!ui`, `!contract` — use as image/PDF captions',
        '`!summary` / `!recap` — summarize recent chat',
        '`!catchup` — show what needs attention',
        '`!about <topic>` — search recent chat history',
        '`!todo` / `!task` — extract tasks from recent chat',
        '`!decisions` / `!decision` — extract decisions/open questions',
        '',
        '━━ *3. Private Brain* ━━',
        '`!remember` / `!save` — save memory',
        '`!recall` / `!find` — search memory',
        '`!brain` — clean and save a brain dump',
        '`!remind me tomorrow 9am to call John`',
        '`!followup Friday about invoice`',
        '_Tip: swipe-reply to any message, then send `!remember`._',
        '',
        '━━ *4. Text & Reply Tools* ━━',
        '`!ask <question>` — quick answer',
        '`!draft` — draft a reply to quoted text',
        '`!explain` — explain quoted or pasted text',
        '`!rewrite <text>` — rewrite text',
        '`!polish <text>` — clean up text',
        '`!formal` / `!casual` — change tone',
        '`!translate <lang> <text>` — translate text',
        '`!shorten` / `!short` — make text shorter',
        '`!bullets` — turn text into bullets',
        '',
        '━━ *5. Content Studio* ━━',
        '`!post` — LinkedIn-style post',
        '`!thread` — X/Twitter thread',
        '`!caption` — social caption',
        '`!script` — short video script',
        '',
        '━━ *6. Public Profile* ━━',
        '`!portfolio` — portfolio snapshot',
        '`!stack` — tech stack',
        '`!projects` — project list',
        '`!hireme` — hiring/work info',
        '`!faq` — list/query FAQs',
        '`!faq add q | answer` — add FAQ (admin)',
        '',
        '━━ *7. Chat Control* ━━',
        '`!mode auto` — normal behavior',
        '`!mode personal` — warmer personal mode',
        '`!mode business` — professional mode',
        '`!mode assistant` — private assistant mode',
        '`!mode draft-only` — queue drafts, do not send',
        '`!mode silent` — silence this chat',
        '`!mute` / `!unmute` — quick silence toggle',
        '',
        '━━ *8. Group Control* ━━',
        '`!groupmode on|off` — group AI features',
        '`!storegroups on|off` — store group history for summaries',
        '',
        '━━ *9. Group Trigger* ━━',
        'Tag your number or type `@eply` in a group.',
        'Swipe-reply works too: reply with `!draft`, `!explain`, `!remember`, etc.',
        '',
        '_Most tools work with pasted text or by swipe-replying to a message._',
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

async function handleAbout({ text, jid, isAdmin, isGroup }) {
    if (!isAdmin) return '❌ Only the admin can search chat history.';
    if (isGroup && db.getSetting('store_group_messages') !== 'true') {
        return 'Group message storage is off. Send `!storegroups on`, let the group chat for a bit, then use `!about payment`.';
    }
    return runThreadTool({ jid, text, tool: 'query', isGroup });
}

function handleMediaHint({ text, isAdmin }) {
    if (!isAdmin) return '❌ Only the admin can use media tools.';
    const command = String(text || '').trim().split(/\s+/)[0];
    return `Send an image or PDF with caption \`${command} what you want me to do\`. Example: send a receipt photo with caption \`!receipt extract expense\`.`;
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
    if (!fact) return 'Usage: `!remember the thing you want me to keep` or reply `!remember` to a message';
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

function handleRemind({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can create reminders.';
    const direct = stripReminderCommand(text);
    const reminderText = direct || String(quotedText || '').trim();
    if (!reminderText) return 'Usage: `!remind me tomorrow 9am to call John`';
    const dueAt = parseDueAt(text);
    db.createReminder({ jid, text: reminderText, dueAt });
    return `Reminder saved for ${new Date(dueAt * 1000).toLocaleString('en-GB')}.`;
}

function handleReminders({ isAdmin }) {
    if (!isAdmin) return '❌ Only the admin can view reminders.';
    const rows = db.getUpcomingReminders(10);
    if (!rows.length) return 'No upcoming reminders.';
    return [
        '*Upcoming reminders*',
        ...rows.map((row, index) => `${index + 1}. ${new Date(row.due_at * 1000).toLocaleString('en-GB')} — ${row.text}`),
    ].join('\n');
}

function textWithQuotedFallback(text, quotedText) {
    const command = String(text || '').split(/\s+/)[0] || '';
    const payload = stripCommandText(text);
    if (payload) return text;
    if (!quotedText) return text;
    return `${command} ${quotedText}`;
}

async function handleExplain({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use utility tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'explain' }) || 'Usage: `!explain your text` or reply `!explain` to a message';
}

async function handleBrain({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can save brain dumps.';
    const payload = textWithQuotedFallback(text, quotedText);
    const result = await runTextTool({ jid, text: payload, tool: 'brain' });
    if (!result) return 'Usage: `!brain your rough idea` or reply `!brain` to a message';
    if (!result.startsWith('No LLM key') && !result.startsWith('I tried to run')) {
        db.saveFact({
            jid: 'private-brain',
            contactName: 'Private Brain',
            fact: result,
            sourceMsg: stripCommandText(payload),
        });
    }
    return result;
}

async function handleDraft({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use utility tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'draft' }) || 'Usage: reply `!draft` to a message or type `!draft what they said`';
}

async function handlePost({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use content tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'post' }) || 'Usage: `!post your idea` or reply `!post` to a message';
}

async function handleThread({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use content tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'thread' }) || 'Usage: `!thread your idea` or reply `!thread` to a message';
}

async function handleCaption({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use content tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'caption' }) || 'Usage: `!caption your idea` or reply `!caption` to a message';
}

async function handleScript({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use content tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'script' }) || 'Usage: `!script your idea` or reply `!script` to a message';
}

function settingLines(key) {
    return String(db.getSetting(key) || '')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function handlePortfolio() {
    const identity = db.getIdentity();
    const links = settingLines('portfolio_links');
    const projects = identity.projects || db.getSetting('portfolio_projects') || 'Projects are being updated.';
    return [
        '*Portfolio*',
        identity.full_name || identity.nickname || 'EPLY owner',
        '',
        projects,
        links.length ? `\n${links.join('\n')}` : '',
    ].filter(Boolean).join('\n');
}

function handleStack() {
    const identity = db.getIdentity();
    return [
        '*Stack*',
        db.getSetting('portfolio_stack') || identity.what_i_do || 'Full-stack/product engineering, AI tooling, dashboards, and automation.',
    ].join('\n');
}

function handleProjects() {
    const identity = db.getIdentity();
    return [
        '*Projects*',
        identity.projects || db.getSetting('portfolio_projects') || 'Project list is being updated.',
    ].join('\n');
}

function handleHireMe() {
    const identity = db.getIdentity();
    return [
        '*Work With Me*',
        db.getSetting('hire_me_text') || `Send a short brief, budget, timeline, and what you want built. ${identity.nickname || identity.full_name || 'I'} will review and respond.`,
    ].join('\n');
}

function getFaqEntries() {
    try {
        return JSON.parse(db.getSetting('faq_entries') || '[]');
    } catch {
        return [];
    }
}

function handleFaq({ text, isAdmin }) {
    const body = stripCommandText(text);
    const entries = getFaqEntries();

    if (!body || body === 'list') {
        if (!entries.length) return 'No FAQs saved yet. Admin: `!faq add question | answer`';
        return ['*FAQ*', ...entries.map((entry, index) => `${index + 1}. ${entry.q}`)].join('\n');
    }

    if (body.toLowerCase().startsWith('add ')) {
        if (!isAdmin) return '❌ Only the admin can add FAQs.';
        const [q, ...answerParts] = body.slice(4).split('|');
        const answer = answerParts.join('|').trim();
        if (!q?.trim() || !answer) return 'Usage: `!faq add question | answer`';
        entries.push({ q: q.trim(), a: answer });
        db.setSetting('faq_entries', JSON.stringify(entries.slice(-60)));
        return 'FAQ saved.';
    }

    const query = body.toLowerCase();
    const match = entries.find((entry) => {
        const q = String(entry.q || '').toLowerCase();
        return q.includes(query) || query.includes(q);
    });
    return match ? match.a : 'No matching FAQ found.';
}

async function handleRewrite({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use utility tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'rewrite' }) || 'Usage: `!rewrite your text` or reply `!rewrite` to a message';
}

async function handlePolish({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use utility tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'polish' }) || 'Usage: `!polish your text` or reply `!polish` to a message';
}

async function handleFormal({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use utility tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'formal' }) || 'Usage: `!formal your text` or reply `!formal` to a message';
}

async function handleCasual({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use utility tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'casual' }) || 'Usage: `!casual your text` or reply `!casual` to a message';
}

async function handleTranslate({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use utility tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'translate' }) || 'Usage: `!translate French your text` or reply `!translate French` to a message';
}

async function handleShorten({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use utility tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'short' }) || 'Usage: `!shorten your text` or reply `!shorten` to a message';
}

async function handleBullets({ text, jid, isAdmin, quotedText }) {
    if (!isAdmin) return '❌ Only the admin can use utility tools.';
    return await runTextTool({ jid, text: textWithQuotedFallback(text, quotedText), tool: 'bullets' }) || 'Usage: `!bullets your text` or reply `!bullets` to a message';
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

function handleMode({ text, jid, isAdmin }) {
    if (!isAdmin) return '❌ Only the admin can change chat mode.';
    const mode = String(text || '').trim().toLowerCase().split(/\s+/)[1];
    const allowed = ['auto', 'personal', 'business', 'assistant', 'draft-only', 'silent'];
    if (!allowed.includes(mode)) {
        return 'Usage: `!mode auto|personal|business|assistant|draft-only|silent`';
    }

    db.saveContactProfile({
        jid,
        chatMode: mode,
        muted: mode === 'silent' ? 1 : 0,
        tonePreference: mode === 'business' ? 'professional' : undefined,
    });

    return `Chat mode set to ${mode}.`;
}

module.exports = { isCommand, runCommand };
