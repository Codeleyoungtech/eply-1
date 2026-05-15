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
const { downloadMediaMessage } = require('baileys');
const { isCommand, runCommand } = require('../engine/commands');
const { applyReplyRules } = require('../engine/replyRules');
const { routeAndReply } = require('../engine/llmRouter');
const { getConversationContext } = require('../engine/contextManager');
const { extractAndStore, getContactMemories } = require('../engine/memoryManager');
const { getAudioMimeType, transcribeVoiceNote } = require('../engine/audioTools');
const { resetFollowUp } = require('../engine/urgencyDetector');
const { sendUrgentPing } = require('../engine/notifier');
const { saveMessage, flagMessage, getSetting, getTodayLlmUsage, getContactProfile } = require('../db/queries');
const { sendMessage, getClient } = require('./connection');
const { logger } = require('../logger');

// ── Text extraction helpers ────────────────────────────────────────────────────

function unwrapMessageContent(content) {
    let current = content;
    for (let i = 0; i < 4; i += 1) {
        if (!current || typeof current !== 'object') break;
        if (current.ephemeralMessage?.message) {
            current = current.ephemeralMessage.message;
            continue;
        }
        if (current.viewOnceMessage?.message) {
            current = current.viewOnceMessage.message;
            continue;
        }
        if (current.viewOnceMessageV2?.message) {
            current = current.viewOnceMessageV2.message;
            continue;
        }
        if (current.documentWithCaptionMessage?.message) {
            current = current.documentWithCaptionMessage.message;
            continue;
        }
        if (current.editedMessage?.message) {
            current = current.editedMessage.message;
            continue;
        }
        break;
    }
    return current;
}

function extractText(msg) {
    const content = unwrapMessageContent(msg?.message);
    if (!content) return null;

    const type = getContentType(content);
    if (!type) return null;

    const m = content[type];
    if (typeof m === 'string') return m.trim() || null;
    if (m?.text) return String(m.text).trim() || null;
    if (m?.caption) return String(m.caption).trim() || null;
    if (m?.conversation) return String(m.conversation).trim() || null;
    if (type === 'buttonsResponseMessage') {
        return m?.selectedDisplayText || m?.selectedButtonId || null;
    }
    if (type === 'listResponseMessage') {
        return m?.title || m?.singleSelectReply?.selectedRowId || null;
    }

    return null;
}

function extractMediaType(msg) {
    const content = unwrapMessageContent(msg?.message);
    const type = getContentType(content);
    if (type === 'imageMessage') return 'image';
    if (type === 'audioMessage') return 'audio';
    if (type === 'documentMessage') return 'document';
    if (type === 'videoMessage') return 'video';
    return null;
}

function extractName(msg) {
    return msg.pushName || msg.key?.remoteJid?.split('@')[0] || 'Unknown';
}

function extractSenderJid(msg) {
    return jidNormalizedUser(
        msg?.key?.participant ||
        msg?.participant ||
        msg?.message?.extendedTextMessage?.contextInfo?.participant ||
        msg?.key?.remoteJid ||
        ''
    );
}

function extractContextInfo(msg) {
    const content = unwrapMessageContent(msg?.message);
    if (!content) return {};
    const type = getContentType(content);
    if (!type) return {};
    return content[type]?.contextInfo || {};
}

function isMentioned(msg, meJid, adminNumber) {
    const body = extractText(msg) || '';
    const normalizedBody = body.toLowerCase();
    const mentioned = extractContextInfo(msg)?.mentionedJid || [];
    const botAliases = String(process.env.EPLY_TRIGGER_NAME || 'eply')
        .split(',')
        .map((alias) => alias.trim().toLowerCase())
        .filter(Boolean);

    if (meJid && mentioned.includes(meJid)) return true;

    const adminJid = `${adminNumber}@s.whatsapp.net`;
    if (adminNumber && mentioned.includes(adminJid)) return true;
    if (adminNumber && body.includes(`@${adminNumber}`)) return true;
    if (botAliases.some((alias) => normalizedBody.includes(`@${alias}`))) return true;

    if (meJid) {
        const meNumber = meJid.split('@')[0];
        if (meNumber && body.includes(`@${meNumber}`)) return true;
    }

    return false;
}

function isReplyToMe(msg, meJid) {
    if (!meJid) return false;
    const contextInfo = extractContextInfo(msg);
    const quotedId = contextInfo?.stanzaId;
    const quotedParticipant = contextInfo?.participant;
    if (!quotedId || !quotedParticipant) return false;
    return jidNormalizedUser(quotedParticipant) === jidNormalizedUser(meJid);
}

function extractQuotedText(msg) {
    const quoted = extractContextInfo(msg)?.quotedMessage;
    if (!quoted) return null;
    return extractText({ message: quoted });
}

function trimHistoryForLlm(history = [], maxMessages = 8, maxCharsPerMessage = 220) {
    return history.slice(-maxMessages).map((message) => ({
        ...message,
        content: (message.content || '').slice(0, maxCharsPerMessage),
    }));
}

function trimMemoriesForLlm(memories = [], maxFacts = 6, maxCharsPerFact = 120) {
    return memories.slice(0, maxFacts).map((memory) => ({
        ...memory,
        fact: (memory.fact || '').slice(0, maxCharsPerFact),
    }));
}

function isChannelOrBroadcast(jid) {
    return jid.endsWith('@newsletter') || (jid.endsWith('@broadcast') && jid !== 'status@broadcast');
}

function normalizeIncomingText(text) {
    if (!text) return null;
    return text.replace(/\s+/g, ' ').trim().slice(0, 600);
}

function estimateTokens(text = '') {
    return Math.ceil(String(text || '').length / 4);
}

function estimateRequestTokens({ incomingText, history = [], historySummary = '', memories = [] }) {
    const historyText = history.map((message) => message.content || '').join(' ');
    const memoryText = memories.map((memory) => memory.fact || '').join(' ');
    return estimateTokens(`${incomingText || ''} ${historyText} ${historySummary || ''} ${memoryText}`) + 400;
}

function getBudgetFallbackReply(isGroup) {
    if (isGroup) return null;
    return 'A bit tied up right now. I will get back to you shortly.';
}

const pendingReplies = new Map();

function getDebounceMs(isGroup) {
    const raw = isGroup
        ? (process.env.GROUP_REPLY_DEBOUNCE_MS || process.env.REPLY_DEBOUNCE_MS || '5000')
        : (process.env.REPLY_DEBOUNCE_MS || '7000');
    const ms = Number(raw);
    if (!Number.isFinite(ms) || ms < 0) return 0;
    return Math.min(ms, 30000);
}

function buildBatchedText(items) {
    const texts = items
        .map((item) => item.text)
        .filter(Boolean);

    if (texts.length <= 1) return texts[0] || '';

    return texts
        .map((text, index) => `Message ${index + 1}: ${text}`)
        .join('\n');
}

function mergePendingItems(items) {
    const last = items[items.length - 1];
    const quotedItem = [...items].reverse().find((item) => item.quotedText);
    return {
        ...last,
        text: buildBatchedText(items),
        mediaType: last.mediaType || items.find((item) => item.mediaType)?.mediaType || null,
        quotedText: quotedItem?.quotedText || null,
        mentionedMe: items.some((item) => item.mentionedMe),
        replyToMe: items.some((item) => item.replyToMe),
        batchSize: items.length,
    };
}

function scheduleReply(prepared) {
    const delay = getDebounceMs(prepared.isGroup);
    if (delay === 0) {
        return processPreparedReply(prepared);
    }

    const key = `${prepared.jid}:${prepared.senderJid || 'unknown'}`;
    const existing = pendingReplies.get(key);
    const items = existing ? [...existing.items, prepared] : [prepared];

    if (existing?.timer) clearTimeout(existing.timer);

    const timer = setTimeout(async () => {
        try {
            pendingReplies.delete(key);
            const merged = mergePendingItems(items);
            if (merged.batchSize > 1) {
                logger.info('Debounced rapid messages into one reply', {
                    jid: merged.jid,
                    senderJid: merged.senderJid,
                    count: merged.batchSize,
                });
            }
            await processPreparedReply(merged);
        } catch (err) {
            logger.error('Debounced reply failed', { err: err.message, stack: err.stack?.split('\n')[1] });
        }
    }, delay);

    pendingReplies.set(key, { timer, items });
    logger.debug('Reply debounce scheduled', { jid: prepared.jid, delay, count: items.length });
}

async function sendReplyChunks(jid, text, quotedMsg = null) {
    const chunks = String(text || '')
        .split(/\n+/)
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .slice(0, 6);

    if (!chunks.length) return;

    for (const [index, chunk] of chunks.entries()) {
        await sendMessage(jid, chunk, index === 0 && quotedMsg ? { quoted: quotedMsg } : {});
    }
}

async function downloadMediaBuffer(msg, sock) {
    return downloadMediaMessage(
        msg,
        'buffer',
        {},
        {
            logger,
            reuploadRequest: sock?.updateMediaMessage?.bind(sock),
        }
    );
}

async function processPreparedReply(prepared) {
    const {
        msg, jid, senderJid, senderPhone, text, mediaType, quotedText, contactName,
        adminNumber, isGroup, contactProfile, groupFeaturesEnabled, mentionedMe,
        replyToMe,
    } = prepared;

    const autoReplyEnvOn  = process.env.AUTO_REPLY_ENABLED === 'true';
    const autoReplyDbOn   = getSetting('auto_reply_enabled') === 'true';
    const autoReplyEnabled = autoReplyEnvOn || autoReplyDbOn;

    if (!autoReplyEnabled) {
        logger.info('Auto-reply is OFF — message logged but not replied. Send !on to enable.', { jid });
        return;
    }

    const rule = applyReplyRules({
        jid, phone: senderPhone, senderJid, text, isGroup,
        mentionedMe, replyToMe, adminNumber, autoReplyEnabled: true,
        groupFeaturesEnabled,
        groupMentionReplies: getSetting('group_mention_replies') !== 'false',
        groupReplyToMeReplies: getSetting('group_reply_to_me_replies') !== 'false',
    });

    logger.debug('Rule result', { action: rule.action, reason: rule.reason });

    if (rule.action === 'silent') return;

    if (rule.action === 'ping_only') {
        await sendUrgentPing({ contactName, theirMsg: text, eplyReply: null, reason: rule.reason, isVip: rule.isVip });
        return;
    }

    if (rule.action === 'vague_flag') {
        const vagueReply = 'let me check and get back to you shortly';
        await sendReplyChunks(jid, vagueReply, msg);
        saveMessage({ jid, contactName, direction: 'out', content: vagueReply, llmUsed: null, isGroup });
        flagMessage({ jid, contactName, theirMsg: text, eplyReply: vagueReply, reason: rule.reason });
        return;
    }

    const hasAnyKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!hasAnyKey) {
        const noKeyMsg = 'EPLY is not fully configured yet. Add at least one working LLM key.';
        await sendMessage(jid, noKeyMsg, { quoted: msg });
        logger.warn('No LLM API keys configured — sent placeholder reply');
        return;
    }

    const context = getConversationContext(jid, {
        fullWindow: 12,
        summaryThreshold: 30,
        fetchLimit: 80,
    });
    const history = trimHistoryForLlm(context.recent);
    const memories = trimMemoriesForLlm(getContactMemories(jid));
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

    const { reply, llm } = await routeAndReply({
        jid, contactName, incomingText, mediaType,
        mediaBuffer: null, history, historySummary: context.summary, memories, isGroup, contactProfile,
    });

    if (!reply) {
        logger.warn('No reply generated — suppressing send', { jid, llm });
        return;
    }

    if (rule.urgency?.urgent) {
        await sendUrgentPing({ contactName, theirMsg: text, eplyReply: reply, reason: rule.urgency.reason, isVip: false });
    }

    await sendReplyChunks(jid, reply, msg);
    resetFollowUp(jid);
    saveMessage({ jid, contactName, direction: 'out', content: reply, llmUsed: llm, isGroup });

    logger.info('✅ Reply sent', { jid, llm, preview: reply.slice(0, 80) });
}

// ── Master handler ────────────────────────────────────────────────────────────

async function handleMessage(msg) {
    try {
        // ── Guard: must have a message body ───────────────────────────────────
        if (!msg?.message) return;

        const jid = msg.key.remoteJid;
        if (!jid) return;
        if (jid === 'status@broadcast') return;
        if (isChannelOrBroadcast(jid) && process.env.ALLOW_CHANNEL_AI !== 'true') {
            logger.debug('Ignoring channel/broadcast message', { jid });
            return;
        }

        // ── Guard: ignore bot's own outgoing messages (not self-chat) ─────────
        const sock = getClient();
        const myJid = sock?.user?.id ? jidNormalizedUser(sock.user.id) : null;
        const isSelfChat = myJid && jidNormalizedUser(jid) === myJid;
        const allowSelfChat = process.env.ALLOW_SELF_CHAT_AI === 'true';

        const isGroup = jid.endsWith('@g.us');
        const senderJid = extractSenderJid(msg);
        const senderPhone = senderJid.replace(/[^0-9]/g, '');
        let text = extractText(msg);
        const mediaType = extractMediaType(msg);
        const quotedText = extractQuotedText(msg);
        const contactName = extractName(msg);
        const adminNumber = process.env.ADMIN_NUMBER || '';
        const isAdmin = msg.key.fromMe || (adminNumber && senderPhone.startsWith(adminNumber));
        const contactProfile = getContactProfile(jid);

        if (isSelfChat && !allowSelfChat && !(text && isCommand(text))) {
            logger.debug('Ignoring self-chat AI message', { jid });
            return;
        }

        if (!text && !mediaType) {
            logger.debug('Ignoring non-content message', { jid, isGroup, isSelfChat });
            return;
        }

        if (mediaType === 'audio' && !text) {
            try {
                const audioBuffer = await downloadMediaBuffer(msg, sock);
                const mimeType = getAudioMimeType(msg);
                const { transcript, provider } = await transcribeVoiceNote({ jid, audioBuffer, mimeType });
                text = transcript;
                logger.info('Voice note transcribed', {
                    jid,
                    provider,
                    chars: transcript.length,
                    preview: transcript.slice(0, 100),
                });
            } catch (err) {
                logger.warn('Voice note transcription failed — suppressing reply', { jid, err: err.message });
                return;
            }
        }

        if (mediaType && !text) {
            logger.debug('Ignoring media-only message until media ingestion is implemented', { jid, mediaType });
            return;
        }

        // ── 1. Built-in commands — ALWAYS work regardless of auto-reply toggle ─
        if (text && isCommand(text)) {
            const cmdReply = await runCommand({ text, jid, isAdmin, isGroup, quotedText });
            if (cmdReply) {
                await sendMessage(jid, cmdReply);
                saveMessage({ jid, contactName, direction: 'out', content: cmdReply, llmUsed: 'builtin', isGroup });
                logger.info('Command handled', { jid, cmd: text.split(' ')[0] });
                return;
            }
        }

        if (contactProfile?.muted) {
            logger.info('Muted contact/thread — silencing reply', { jid });
            return;
        }

        // ── Bot guard: skip own outgoing messages (except self-chat for testing)
        if (msg.key.fromMe && !allowSelfChat) {
            // Save to context so LLM knows what we've already said manually
            if (text) saveMessage({ jid, contactName, direction: 'out', content: text, mediaType, isGroup, llmUsed: 'manual' });
            return;
        }

        // ── Log every real message received ───────────────────────────────────
        logger.info('▶ Message received', {
            from: contactName,
            jid,
            senderJid,
            isSelfChat,
            isGroup,
            preview: (text || `[${mediaType}]` || '(empty)').slice(0, 80),
        });

        // ── Save incoming message to DB ────────────────────────────────────────
        const storeGroupMessages = getSetting('store_group_messages') === 'true';
        const groupFeaturesEnabled = getSetting('group_features_enabled') !== 'false';
        if (text || mediaType) {
            if (!isGroup || storeGroupMessages) {
                saveMessage({ jid, contactName, direction: 'in', content: text, mediaType, isGroup });
            }
        }

        // ── Extract memory facts ───────────────────────────────────────────────
        if (!isGroup && text) extractAndStore(jid, contactName, text);

        const mentionedMe = isGroup ? isMentioned(msg, myJid, adminNumber) : false;
        const replyToMe = isGroup ? isReplyToMe(msg, myJid) : false;

        await scheduleReply({
            msg, jid, senderJid, senderPhone, text, mediaType, quotedText,
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
