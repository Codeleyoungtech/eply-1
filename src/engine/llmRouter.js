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

const providerCooldowns = new Map();

function hasProviderKey(model) {
    if (model === 'groq') return !!process.env.GROQ_API_KEY;
    if (model === 'gemini') return !!process.env.GEMINI_API_KEY;
    if (model === 'claude') return !!process.env.ANTHROPIC_API_KEY;
    return false;
}

function getProviderCooldown(model) {
    const state = providerCooldowns.get(model);
    if (!state) return null;
    if (state.until <= Date.now()) {
        providerCooldowns.delete(model);
        return null;
    }
    return state;
}

function isProviderAvailable(model) {
    return hasProviderKey(model) && !getProviderCooldown(model);
}

function parseRetryDelayMs(message = '') {
    const minuteSecondMatch = message.match(/try again in (\d+)m([\d.]+)s/i);
    if (minuteSecondMatch) {
        const minutes = Number(minuteSecondMatch[1] || 0);
        const seconds = Number(minuteSecondMatch[2] || 0);
        return ((minutes * 60) + seconds) * 1000;
    }

    const secondMatch = message.match(/try again in ([\d.]+)s/i);
    if (secondMatch) {
        return Number(secondMatch[1] || 0) * 1000;
    }

    return null;
}

function getProviderErrorType(err) {
    const message = String(err?.message || '').toLowerCase();
    if (message.includes('api key not valid') || message.includes('api_key_invalid') || message.includes('invalid x-api-key')) {
        return 'auth';
    }
    if (message.includes('rate limit') || message.includes('rate_limit') || message.includes('too many requests')) {
        return 'rate_limit';
    }
    return 'other';
}

function markProviderCooldown(model, err) {
    const type = getProviderErrorType(err);
    if (type === 'other') return;

    const retryDelayMs = parseRetryDelayMs(err?.message || '');
    const until = Date.now() + (
        type === 'auth'
            ? 60 * 60 * 1000
            : retryDelayMs || (10 * 60 * 1000)
    );

    providerCooldowns.set(model, {
        until,
        reason: type,
        message: err?.message || 'provider temporarily disabled',
    });

    logger.warn('Provider temporarily disabled', {
        model,
        reason: type,
        retryInSeconds: Math.ceil((until - Date.now()) / 1000),
    });
}

function getFallbackOrder(primary) {
    const preference = ['groq', 'claude', 'gemini'];
    return [primary, ...preference.filter(model => model !== primary)];
}

async function callProvider(model, systemPrompt, messages, ctx) {
    if (model === 'gemini') {
        return callGemini(systemPrompt, messages, ctx.mediaBuffer, ctx.mediaType);
    }
    if (model === 'claude') {
        return callClaude(systemPrompt, messages);
    }
    return callGroq(systemPrompt, messages);
}

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
    const toneCtx = classify(ctx.incomingText || '', ctx.history);

    // Determine which model to use
    let selectedModel = defaultModel;

    if (defaultModel === 'auto') {
        if ((ctx.mediaType === 'image' || ctx.mediaType === 'document') && ctx.mediaBuffer) {
            selectedModel = 'gemini';
        } else if (ctx.mediaType === 'audio' && ctx.mediaBuffer) {
            selectedModel = 'groq'; // Groq Whisper transcription path
        } else if (toneCtx === 'work' || toneCtx === 'business' || toneCtx === 'sensitive') {
            selectedModel = 'claude';
        } else {
            selectedModel = 'groq'; // Default — fast path for casual DMs
        }
    }

    logger.debug('Routing to LLM', { model: selectedModel, jid: ctx.jid, toneCtx });

    const candidates = getFallbackOrder(selectedModel).filter((model, index, all) => {
        return all.indexOf(model) === index && isProviderAvailable(model);
    });

    if (candidates.length === 0) {
        logger.warn('No LLM providers available', { jid: ctx.jid, selectedModel });
        return { reply: null, llm: 'none' };
    }

    for (const model of candidates) {
        const { systemPrompt, messages } = buildPrompt({
            identity,
            contactName: ctx.contactName,
            incomingText: ctx.incomingText,
            history: ctx.history,
            memories: ctx.memories,
            toneCtx,
            model,
        });

        try {
            const reply = await callProvider(model, systemPrompt, messages, ctx);
            return { reply, llm: model };
        } catch (err) {
            markProviderCooldown(model, err);
            logger.error('LLM provider failed', { model, err: err.message });
        }
    }

    logger.warn('All LLM providers failed', { jid: ctx.jid, selectedModel });
    return { reply: null, llm: 'none' };
}

module.exports = { routeAndReply };
