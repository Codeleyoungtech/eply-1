'use strict';

/**
 * WhatsApp Message Handler
 * Orchestrates the full pipeline:
 *  1. Incoming message parsing (Baileys)
 *  2. Duplicate/History filtering
 *  3. Context extraction (Identity + History)
 *  4. Reply rules (VIP guard, group silent logic, spam)
 *  5. LLM routing & generation
 *  6. Outgoing response delivery
 */

const { logger } = require('../logger');
const { getConversationContext, trimHistoryForLlm, trimMemoriesForLlm, normalizeIncomingText, estimateRequestTokens } = require('../engine/contextManager');
const { applyReplyRules, getBudgetFallbackReply } = require('../engine/replyRules');
const { routeAndReply } = require('../engine/llmRouter');
const { extractAndStore, getContactMemories } = require('../engine/memoryManager');
const { saveMessage, getContactProfile, getTodayLlmUsage, getSetting, flagMessage, saveContactProfile } = require('../db/queries');
const { sendUrgentPing } = require('../engine/notifier');
const { isCommand, runCommand } = require('../engine/commands');
const { sendMessage, sendPresence } = require('./connection');

const lastAutoReplyAt = new Map();
const followUpTimers = new Map();

/**
 * Deduplication helper — checks if content has been processed recently.
 * Prevents loops if two bots talk to each other.
 */
const processedRecent = new Map(); // key: contentHash, val: timestamp

function isDuplicate(text) {
    if (!text) return false;
    const now = Date.now();
    const entry = processedRecent.get(text);
    if (entry && (now - entry < 5000)) return true;
    processedRecent.set(text, now);
    // Cleanup old entries every 100 calls
    if (processedRecent.size > 200) {
        for (const [k, v] of processedRecent.entries()) {
            if (now - v > 30000) processedRecent.delete(k);
        }
    }
    return false;
}

function extractText(msg) {
    const content = msg.message;
    if (!content) return '';
    if (content.conversation) return content.conversation;
    if (content.extendedTextMessage?.text) return content.extendedTextMessage.text;
    if (content.imageMessage?.caption) return content.imageMessage.caption;
    if (content.videoMessage?.caption) return content.videoMessage.caption;
    if (content.documentMessage?.caption) return content.documentMessage.caption;
    return '';
}

function extractQuotedText(msg) {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted) return null;
    if (quoted.conversation) return quoted.conversation;
    if (quoted.extendedTextMessage?.text) return quoted.extendedTextMessage.text;
    return null;
}

function getContentType(content) {
    if (!content) return null;
    return Object.keys(content)[0];
}

function getMimeType(msg) {
    const content = msg.message;
    const type = getContentType(content);
    if (!type) return null;
    return content[type]?.mimetype || null;
}

function extractName(msg) {
    return msg.pushName || msg.key?.remoteJid?.split('@')[0] || 'Unknown';
}

async function downloadMediaBuffer(msg, sock) {
    const { downloadMediaMessage } = require('baileys');
    try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });
        return buffer;
    } catch (err) {
        logger.error('Media download failed', { err: err.message });
        return null;
    }
}

/**
 * Main worker for processing a single message.
 * Extracts context, runs reply rules, calls LLM, and sends reply.
 */
async function scheduleReply({
    msg, jid, senderJid, senderPhone, text, mediaType, mediaBuffer, quotedText,
    contactName, adminNumber, isGroup, contactProfile,
    groupFeaturesEnabled,
    mentionedMe,
    replyToMe,
}) {
    const rule = applyReplyRules({
        jid, text, mediaType, isGroup, contactProfile,
        groupFeaturesEnabled,
        mentionedMe,
        replyToMe,
    });

    if (rule.action === 'silent') {
        logger.debug('Message ignored by rules', { jid, reason: rule.reason });
        return;
    }

    const context = getConversationContext(jid, {
        fullWindow: 12,
        summaryThreshold: 30,
        fetchLimit: 80,
    });
    const history = trimHistoryForLlm(context.recent);
    const memories = trimMemoriesForLlm(await getContactMemories(jid));
    const todayUsage = getTodayLlmUsage() || {};
    const dailyReplyLimit = Number(getSetting('daily_reply_limit') || 80);
    const dailyTokenLimit = Number(getSetting('daily_estimated_token_limit') || 12000);
    const estimatedRequestTokens = estimateRequestTokens({
        incomingText: normalizeIncomingText(text),
        history,
        historySummary: context.summary,
        memories,
    });

    if (
        (Number.isFinite(dailyReplyLimit) && dailyReplyLimit > 0 && Number(todayUsage.calls || 0) >= dailyReplyLimit) ||
        (Number.isFinite(dailyTokenLimit) && dailyTokenLimit > 0 && (Number(todayUsage.estimated_total || 0) + estimatedRequestTokens) >= dailyTokenLimit)
    ) {
        const fallbackReply = getBudgetFallbackReply(isGroup);
        logger.warn('Daily LLM budget reached — suppressing model call', {
            jid,
            estimatedRequestTokens,
            todayCalls: todayUsage.calls || 0,
            todayEstimatedTokens: todayUsage.estimated_total || 0,
        });
        if (fallbackReply) {
            await sendReplyChunks(jid, fallbackReply, msg);
            saveMessage({ jid, contactName, direction: 'out', content: fallbackReply, llmUsed: null, isGroup });
        }
        return;
    }

    const incomingText = quotedText
        ? `Replying to this message: "${normalizeIncomingText(quotedText)}"\nTheir new message: ${normalizeIncomingText(text)}`
        : normalizeIncomingText(text);

    // Show typing status while thinking
    await sendPresence(jid, 'composing');

    const { reply, llm } = await routeAndReply({
        jid, contactName, incomingText, mediaType,
        mediaBuffer: mediaBuffer || null, history, historySummary: context.summary, memories, isGroup, contactProfile,
    });

    // Stop typing status
    await sendPresence(jid, 'paused');

    if (!reply) {
        logger.warn('No reply generated — suppressing send', { jid, llm });
        return;
    }

    if (contactProfile?.chat_mode === 'draft-only') {
        flagMessage({ jid, contactName, theirMsg: text, eplyReply: reply, reason: 'draft_only_mode' });
        saveMessage({ jid, contactName, direction: 'out', content: `[draft] ${reply}`, llmUsed: llm, isGroup });
        logger.info('Draft-only mode — reply saved to flagged queue, not sent', { jid, preview: reply.slice(0, 80) });
        return;
    }

    if (rule.urgency?.urgent) {
        await sendUrgentPing({ contactName, theirMsg: text, eplyReply: reply, reason: rule.urgency.reason, isVip: false });
    }

    await sendReplyChunks(jid, reply, msg);
    lastAutoReplyAt.set(jid, Date.now());
    resetFollowUp(jid);
    saveMessage({ jid, contactName, direction: 'out', content: reply, llmUsed: llm, isGroup });

    logger.info('✅ Reply sent', { jid, llm, preview: reply.slice(0, 80) });
}

async function sendReplyChunks(jid, reply, quoted) {
    // Basic chunking if message is very long
    if (reply.length < 700) {
        await sendMessage(jid, reply, { quoted });
    } else {
        const chunks = reply.match(/[\s\S]{1,700}(?:\n|$)|[\s\S]{1,700}/g) || [reply];
        for (const chunk of chunks) {
            await sendMessage(jid, chunk.trim(), { quoted });
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

function resetFollowUp(jid) {
    const existing = followUpTimers.get(jid);
    if (existing) clearTimeout(existing);
    followUpTimers.delete(jid);
}

function isMentioned(msg, myJid, adminNumber) {
    const text = extractText(msg).toLowerCase();
    const myNumber = myJid.split('@')[0];
    const botAliases = ['@eply', 'eply', 'bot', 'assistant'];
    const mentionedIds = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const isExplicitlyTagged = mentionedIds.includes(myJid) || mentionedIds.includes(`${adminNumber}@s.whatsapp.net`);
    const containsBotName = botAliases.some(alias => text.includes(alias));
    return isExplicitlyTagged || containsBotName;
}

function isReplyToMe(msg, myJid) {
    const quotedJid = msg.message?.extendedTextMessage?.contextInfo?.participant;
    return quotedJid === myJid;
}

// ── Master handler ────────────────────────────────────────────────────────────

async function handleMessage(msg) {
    try {
        // ── Guard: must have a message body ───────────────────────────────────
        if (!msg?.message) return;

        const jid = msg.key.remoteJid;
        if (!jid) return;

        // ── Identity info ─────────────────────────────────────────────────────
        const myJid = require('./connection').getClient()?.user?.id?.split(':')[0] + '@s.whatsapp.net';
        const adminNumber = process.env.ADMIN_NUMBER;
        const isFromMe = msg.key.fromMe;
        const isGroup = jid.endsWith('@g.us');
        const contactName = extractName(msg);
        const senderJid = isGroup ? msg.key.participant : jid;
        const senderPhone = senderJid?.split('@')[0] || '';
        const isAdmin = senderPhone === adminNumber;

        // ── Parse content ─────────────────────────────────────────────────────
        const text = extractText(msg);
        const quotedText = extractQuotedText(msg);
        const mediaType = getMimeType(msg)?.split('/')[0] || null;

        // ── LOOP GUARD: never reply to yourself ─────────────────────────────
        if (isFromMe) return;

        // ── Deduplicate ───────────────────────────────────────────────────────
        if (isDuplicate(text)) return;

        // ── Auto-save contact profile ─────────────────────────────────────────
        if (!isGroup) {
            saveContactProfile({ jid, displayName: contactName });
        }
        const contactProfile = getContactProfile(jid);
        const groupFeaturesEnabled = getSetting('group_features_enabled') === 'true';

        // ── 1. Process Built-in Commands (!ping, !off, !summary, !video etc.) ───
        if (isCommand(text)) {
            const commandReply = await runCommand({ text, jid, isAdmin, isGroup, quotedText });
            if (commandReply) {
                await sendMessage(jid, commandReply, { quoted: msg });
                return;
            }
        }

        // ── 2. Handle Media (Images, PDFs) ────────────────────────────────────
        let mediaBuffer = null;
        if ((mediaType === 'image' || mediaType === 'document') && process.env.ENABLE_MEDIA_UNDERSTANDING !== 'false') {
            try {
                const sock = require('./connection').getClient();
                mediaBuffer = await downloadMediaBuffer(msg, sock);
                logger.info('Media downloaded for analysis', { jid, type: mediaType });
            } catch (err) {
                logger.warn('Media download skipped', { err: err.message });
            }
        }

        // ── Store incoming message in DB ──────────────────────────────────────
        if (text || mediaType) {
            if (isGroup && getSetting('store_group_messages') === 'true') {
                saveMessage({ jid, contactName, direction: 'in', content: text, mediaType, isGroup });
            } else if (!isGroup) {
                saveMessage({ jid, contactName, direction: 'in', content: text, mediaType, isGroup });
            }
        }

        // ── Extract memory facts ───────────────────────────────────────────────
        if (!isGroup && text) await extractAndStore(jid, contactName, text);

        const mentionedMe = isGroup ? isMentioned(msg, myJid, adminNumber) : false;
        const replyToMe = isGroup ? isReplyToMe(msg, myJid) : false;

        if (isGroup) {
            logger.debug('Group trigger check', {
                jid,
                mentionedMe,
                replyToMe,
                groupFeaturesEnabled,
                text: text?.slice(0, 50)
            });
        }

        await scheduleReply({
            msg, jid, senderJid, senderPhone, text, mediaType, mediaBuffer, quotedText,
            contactName, adminNumber, isGroup, contactProfile,
            groupFeaturesEnabled,
            mentionedMe,
            replyToMe,
        });

    } catch (err) {
        logger.error('Message handler crashed', { err: err.message, stack: err.stack?.split('\n')[1] });
    }
}

module.exports = { handleMessage };
