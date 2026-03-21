'use strict';

/**
 * Central Message Handler
 * Pipeline order:
 *  1. Built-in commands (!ping, !help, etc.) — always work, no LLM
 *  2. Bot guard (skip own messages, status broadcasts, history)
 *  3. Auto-reply master switch (env + DB setting)
 *  4. Reply rules (VIP guard, group silent logic, spam)
 *  5. LLM routing → send reply
 */

const { jidNormalizedUser, getContentType } = require('baileys');
const { isCommand, runCommand } = require('../engine/commands');
const { applyReplyRules } = require('../engine/replyRules');
const { routeAndReply } = require('../engine/llmRouter');
const { getConversationContext } = require('../engine/contextManager');
const { extractAndStore, getContactMemories } = require('../engine/memoryManager');
const { detectUrgency, resetFollowUp } = require('../engine/urgencyDetector');
const { sendUrgentPing } = require('../engine/notifier');
const { saveMessage, flagMessage, getSetting } = require('../db/queries');
const { sendMessage, getClient } = require('./connection');
const { logger } = require('../logger');

// ── Text extraction helpers ────────────────────────────────────────────────────

function extractText(msg) {
    if (!msg.message) return null;
    const type = getContentType(msg.message);
    if (!type) return null;
    const m = msg.message[type];
    if (typeof m === 'string') return m;
    if (m?.text) return m.text;
    if (m?.caption) return m.caption;
    if (m?.conversation) return m.conversation;
    return null;
}

function extractMediaType(msg) {
    const type = getContentType(msg?.message);
    if (type === 'imageMessage')    return 'image';
    if (type === 'audioMessage')    return 'audio';
    if (type === 'documentMessage') return 'document';
    if (type === 'videoMessage')    return 'video';
    return null;
}

function extractName(msg) {
    return msg.pushName || msg.key?.remoteJid?.split('@')[0] || 'Unknown';
}

function isMentioned(msg, adminNumber) {
    const body = extractText(msg) || '';
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const adminJid = `${adminNumber}@s.whatsapp.net`;
    return mentioned.includes(adminJid) || body.includes(`@${adminNumber}`);
}

function isReplyToMe(msg) {
    const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
    const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
    return !!quotedId && !quotedParticipant;
}

// ── Master handler ────────────────────────────────────────────────────────────

async function handleMessage(msg) {
    try {
        // ── Guard: must have a message body ───────────────────────────────────
        if (!msg?.message) return;

        const jid = msg.key.remoteJid;
        if (!jid) return;
        if (jid === 'status@broadcast') return;

        // ── Guard: ignore bot's own outgoing messages (not self-chat) ─────────
        const sock = getClient();
        const myJid = sock?.user?.id ? jidNormalizedUser(sock.user.id) : null;
        const isSelfChat = myJid && jidNormalizedUser(jid) === myJid;

        const isGroup = jid.endsWith('@g.us');
        const text = extractText(msg);
        const mediaType = extractMediaType(msg);
        const contactName = extractName(msg);
        const adminNumber = process.env.ADMIN_NUMBER || '';
        const isAdmin = adminNumber && jid.startsWith(adminNumber);

        // ── 1. Built-in commands — ALWAYS work regardless of auto-reply toggle ─
        if (text && isCommand(text)) {
            const cmdReply = await runCommand({ text, jid, isAdmin });
            if (cmdReply) {
                await sendMessage(jid, cmdReply);
                saveMessage({ jid, contactName, direction: 'out', content: cmdReply, llmUsed: 'builtin', isGroup });
                logger.info('Command handled', { jid, cmd: text.split(' ')[0] });
                return;
            }
        }

        // ── Bot guard: skip own outgoing messages (except self-chat for testing)
        if (msg.key.fromMe && !isSelfChat) {
            // Save to context so LLM knows what we've already said manually
            if (text) saveMessage({ jid, contactName, direction: 'out', content: text, mediaType, isGroup, llmUsed: 'manual' });
            return;
        }

        // ── Log every real message received ───────────────────────────────────
        logger.info('▶ Message received', {
            from: contactName,
            jid,
            isSelfChat,
            isGroup,
            preview: (text || `[${mediaType}]` || '(empty)').slice(0, 80),
        });

        // ── Save incoming message to DB ────────────────────────────────────────
        if (text || mediaType) {
            saveMessage({ jid, contactName, direction: 'in', content: text, mediaType, isGroup });
        }

        // ── Extract memory facts ───────────────────────────────────────────────
        if (!isGroup && text) extractAndStore(jid, contactName, text);

        // ── 2. Auto-reply master switch ────────────────────────────────────────
        const autoReplyEnvOn  = process.env.AUTO_REPLY_ENABLED === 'true';
        const autoReplyDbOn   = getSetting('auto_reply_enabled') === 'true';
        const autoReplyEnabled = autoReplyEnvOn || autoReplyDbOn;

        if (!autoReplyEnabled) {
            logger.info('Auto-reply is OFF — message logged but not replied. Send !on to enable.', { jid });
            return;
        }

        // ── 3. Reply rules (VIP, group, spam) ─────────────────────────────────
        const mentionedMe = isGroup ? isMentioned(msg, adminNumber) : false;
        const replyToMe   = isGroup ? isReplyToMe(msg) : false;

        const rule = applyReplyRules({
            jid, phone: jid.replace(/[^0-9]/g, ''), text, isGroup,
            mentionedMe, replyToMe, adminNumber, autoReplyEnabled: true, // we already checked above
        });

        logger.debug('Rule result', { action: rule.action, reason: rule.reason });

        if (rule.action === 'silent') return;

        if (rule.action === 'ping_only') {
            await sendUrgentPing({ contactName, theirMsg: text, eplyReply: null, reason: rule.reason, isVip: rule.isVip });
            return;
        }

        if (rule.action === 'vague_flag') {
            const vagueReplies = [
                'haha let me check on that',
                'yeah need to look into that properly',
                'lol let me get back to you on that one',
                "that's a whole conversation, catch up soon?",
            ];
            const vagueReply = vagueReplies[Math.floor(Math.random() * vagueReplies.length)];
            await sendMessage(jid, vagueReply);
            saveMessage({ jid, contactName, direction: 'out', content: vagueReply, llmUsed: null, isGroup });
            flagMessage({ jid, contactName, theirMsg: text, eplyReply: vagueReply, reason: rule.reason });
            return;
        }

        // ── 4. LLM reply ──────────────────────────────────────────────────────
        // Check API keys first — helpful error instead of silent failure
        const hasAnyKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;
        if (!hasAnyKey) {
            const noKeyMsg = "hey, EPLY isn't fully configured yet — add at least a Groq API key in settings 🔧";
            await sendMessage(jid, noKeyMsg);
            logger.warn('No LLM API keys configured — sent placeholder reply');
            return;
        }

        const history  = getConversationContext(jid, 15);
        const memories = getContactMemories(jid);

        const { reply, llm } = await routeAndReply({
            jid, contactName, incomingText: text, mediaType,
            mediaBuffer: null, history, memories, isGroup,
        });

        // ── Urgency check ──────────────────────────────────────────────────────
        if (rule.urgency?.urgent) {
            await sendUrgentPing({ contactName, theirMsg: text, eplyReply: reply, reason: rule.urgency.reason, isVip: false });
        }

        // ── Send reply ────────────────────────────────────────────────────────
        await sendMessage(jid, reply);
        resetFollowUp(jid);
        saveMessage({ jid, contactName, direction: 'out', content: reply, llmUsed: llm, isGroup });

        logger.info('✅ Reply sent', { jid, llm, preview: reply.slice(0, 80) });

    } catch (err) {
        logger.error('Message handler crashed', { err: err.message, stack: err.stack?.split('\n')[1] });
    }
}

module.exports = { handleMessage };
