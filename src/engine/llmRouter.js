'use strict';

/**
 * LLM Router — decides which model handles a given message.
 * Routes entirely based on hardcoded message-type logic from PRD §5.3.
 */

const { getIdentity, getAllSettings } = require('../db/queries');
const { callGroq } = require('../llm/groq');
const { callGemini } = require('../llm/gemini');
const { callClaude } = require('../llm/claude');
const { buildPrompt } = require('./promptBuilder');
const { classify } = require('./toneClassifier');
const { logger } = require('../logger');

/**
 * @param {object} ctx
 * @param {string} ctx.jid
 * @param {string} ctx.contactName
 * @param {string} ctx.incomingText
 * @param {string|null} ctx.mediaType  — 'image' | 'audio' | 'document' | 'video' | null
 * @param {Buffer|null} ctx.mediaBuffer
 * @param {Array}  ctx.history         — last 15 messages [{role,content}]
 * @param {Array}  ctx.memories        — facts about this contact
 * @param {boolean} ctx.isGroup
 * @returns {{ reply: string, llm: string }}
 */
async function routeAndReply(ctx) {
    const settings = getAllSettings();
    const defaultModel = (settings.default_model || process.env.DEFAULT_MODEL || 'auto').toLowerCase();

    const identity = getIdentity();
    const toneCtx = classify(ctx.incomingText, ctx.history);

    // Determine which model to use
    let selectedModel = defaultModel;

    if (defaultModel === 'auto') {
        if (ctx.mediaType === 'image' || ctx.mediaType === 'document') {
            selectedModel = 'gemini';
        } else if (ctx.mediaType === 'audio') {
            selectedModel = 'groq'; // Groq Whisper transcription path
        } else if (toneCtx === 'work' || toneCtx === 'business' || toneCtx === 'sensitive') {
            selectedModel = 'claude';
        } else {
            selectedModel = 'groq'; // Default — fast path for casual DMs
        }
    }

    const { systemPrompt, messages } = buildPrompt({
        identity,
        contactName: ctx.contactName,
        incomingText: ctx.incomingText,
        history: ctx.history,
        memories: ctx.memories,
        toneCtx,
        model: selectedModel,
    });

    logger.debug('Routing to LLM', { model: selectedModel, jid: ctx.jid, toneCtx });

    let reply;
    try {
        if (selectedModel === 'gemini') {
            reply = await callGemini(systemPrompt, messages, ctx.mediaBuffer, ctx.mediaType);
        } else if (selectedModel === 'claude') {
            reply = await callClaude(systemPrompt, messages);
        } else {
            reply = await callGroq(systemPrompt, messages);
        }
    } catch (err) {
        logger.error('Primary LLM failed — falling back to Groq', { model: selectedModel, err: err.message });
        try {
            reply = await callGroq(systemPrompt, messages);
            selectedModel = 'groq';
        } catch (fallbackErr) {
            logger.error('Groq fallback also failed', { err: fallbackErr.message });
            reply = "haha let me get back to you on that one";
        }
    }

    return { reply, llm: selectedModel };
}

module.exports = { routeAndReply };
