'use strict';

/**
 * Central Message Handler — receives all WhatsApp messages and orchestrates
 * the full reply pipeline: rules → LLM → send → log → memory → notify.
 */

const {
    jidNormalizedUser,
    getContentType,
} = require('baileys');
const { applyReplyRules } = require('../engine/replyRules');
const { routeAndReply } = require('../engine/llmRouter');
const { getConversationContext } = require('../engine/contextManager');
const { extractAndStore, getContactMemories } = require('../engine/memoryManager');
const { detectUrgency, resetFollowUp } = require('../engine/urgencyDetector');
const { sendUrgentPing } = require('../engine/notifier');
const { isVip, saveMessage, flagMessage, getSetting } = require('../db/queries');
const { sendMessage, getClient } = require('./connection');
const { logger } = require('../logger');

/** Extract text content from a Baileys message object */
function extractText(msg) {
    const type = getContentType(msg.message);
    if (!type) return null;
    const m = msg.message[type];
    if (typeof m === 'string') return m;
    if (m?.text) return m.text;
    if (m?.caption) return m.caption;
    if (m?.conversation) return m.conversation;
    return null;
}

/** Extract media type from a Baileys message */
function extractMediaType(msg) {
    const type = getContentType(msg.message);
    if (!type) return null;
    if (type === 'imageMessage') return 'image';
    if (type === 'audioMessage') return 'audio';
    if (type === 'documentMessage') return 'document';
    if (type === 'videoMessage') return 'video';
    return null;
}

/** Extract the display name from a message */
function extractName(msg) {
    return (
        msg.pushName ||
        msg.key?.remoteJid?.split('@')[0] ||
        'Unknown'
    );
}

/** Check if the message @mentions our number or name */
function checkMentions(msg, adminNumber, adminName) {
    const body = extractText(msg) || '';
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const adminJid = `${adminNumber}@s.whatsapp.net`;

    // Direct @mention of admin number
    if (mentioned.includes(adminJid)) return true;
    // @mention by name in text
    if (adminName && body.toLowerCase().includes(adminName.toLowerCase())) return true;
    // @mention of the bot itself (same number)
    if (body.includes(`@${adminNumber}`)) return true;

    return false;
}

/** Check if this is a reply to one of our previously sent messages */
function checkReplyToMe(msg) {
    const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
    const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
    // If there's a quoted message and it's attributed to us (fromMe pattern)
    return !!quotedId && !quotedParticipant; // rough heuristic — fromMe quoted msgs have no participant
}

async function handleMessage(msg) {
    try {
        if (!msg?.message) return;

        // Ignore messages sent by THIS bot instance (Baileys IDs start with BAE5)
        const isBotMsg = msg.key.id?.startsWith('BAE5');
        if (isBotMsg) return;

        const jid = msg.key.remoteJid;
        if (!jid) return;
        if (jid === 'status@broadcast') return;

        const sock = getClient();
        const myJid = sock?.user?.id ? jidNormalizedUser(sock.user.id) : null;
        const isSelfChat = myJid && jidNormalizedUser(jid) === myJid;

        const isGroup = jid.endsWith('@g.us');
        const phone = isGroup
            ? (msg.key.participant || '').replace(/[^0-9]/g, '')
            : jid.replace(/[^0-9]/g, '');

        const text = extractText(msg);
        const mediaType = extractMediaType(msg);
        const contactName = extractName(msg);

        // ── Save message to context (even if we sent it manually) ─────────────
        const direction = msg.key.fromMe && !isSelfChat ? 'out' : 'in';
        if (text || mediaType) {
            saveMessage({
                jid,
                contactName,
                direction,
                content: text,
                mediaType,
                isGroup,
                llmUsed: msg.key.fromMe ? 'manual' : null
            });
        }

        if (msg.key.fromMe && !isSelfChat) {
            // This is a manual reply sent from our phone to someone else.
            // It's saved for DB context, but we DO NOT want EPLY to reply.
            return;
        }

        const adminNumber = process.env.ADMIN_NUMBER || '';
        const adminName = ''; // populated from identity if set

        const mentionedMe = isGroup ? checkMentions(msg, adminNumber, adminName) : false;
        const replyToMe = isGroup ? checkReplyToMe(msg) : false;

        const autoReplyEnabled = getSetting('auto_reply_enabled') !== 'false'
            && process.env.AUTO_REPLY_ENABLED !== 'false';

        logger.info('Message received', { jid, isSelfChat, isGroup, preview: (text || '').slice(0, 60) });

        // ── Extract memory facts from DMs ─────────────────────────────────────
        if (!isGroup && text) {
            extractAndStore(jid, contactName, text);
        }

        // ── Apply hardcoded reply rules ───────────────────────────────────────
        const ruleResult = applyReplyRules({
            jid, phone, text, isGroup, mentionedMe, replyToMe, adminNumber, autoReplyEnabled,
        });

        logger.debug('Rule result', { action: ruleResult.action, reason: ruleResult.reason });

        if (ruleResult.action === 'silent') {
            // VIP silent — still check urgency for ping
            if (ruleResult.isVip) {
                const urgency = detectUrgency({ jid, text, isVip: true });
                if (urgency.urgent) {
                    await sendUrgentPing({ contactName, theirMsg: text, eplyReply: null, reason: 'vip_urgent', isVip: true });
                }
            }
            return;
        }

        if (ruleResult.action === 'ping_only') {
            await sendUrgentPing({ contactName, theirMsg: text, eplyReply: null, reason: ruleResult.reason, isVip: ruleResult.isVip });
            return;
        }

        if (ruleResult.action === 'vague_flag') {
            // Generate vague reply and flag it
            const vagueReplies = [
                "haha let me check my situation",
                "yeah need to look into that properly",
                "haha let me get back to you on that one",
                "that's a whole conversation — let's catch up soon?",
                "lol let me think on that one",
            ];
            const vagueReply = vagueReplies[Math.floor(Math.random() * vagueReplies.length)];
            await sendMessage(jid, vagueReply);
            saveMessage({ jid, contactName, direction: 'out', content: vagueReply, llmUsed: null, isGroup });
            flagMessage({ jid, contactName, theirMsg: text, eplyReply: vagueReply, reason: ruleResult.reason });
            await sendUrgentPing({ contactName, theirMsg: text, eplyReply: vagueReply, reason: ruleResult.reason, isVip: false });
            return;
        }

        // ── action === 'reply' — Generate LLM reply ───────────────────────────
        const history = getConversationContext(jid, 15);
        const memories = getContactMemories(jid);

        const { reply, llm } = await routeAndReply({
            jid, contactName, incomingText: text, mediaType, mediaBuffer: null, // media download omitted for now
            history, memories, isGroup,
        });

        // ── Check for urgency on normal replies too ───────────────────────────
        const { urgent, reason: urgReason } = ruleResult.urgency || {};
        if (urgent && urgReason !== 'normal') {
            await sendUrgentPing({ contactName, theirMsg: text, eplyReply: reply, reason: urgReason, isVip: false });
        }

        // ── Send reply ────────────────────────────────────────────────────────
        await sendMessage(jid, reply);
        resetFollowUp(jid);

        // ── Save outgoing message ─────────────────────────────────────────────
        saveMessage({ jid, contactName, direction: 'out', content: reply, llmUsed: llm, isGroup });

        logger.info('Reply sent', { jid, llm, preview: reply.slice(0, 80) });
    } catch (err) {
        logger.error('Message handler error', { err: err.message, stack: err.stack });
    }
}

module.exports = { handleMessage };
