'use strict';

const { getSetting, getThread, recordLlmUsage } = require('../db/queries');
const { callGroq } = require('../llm/groq');
const { callGemini } = require('../llm/gemini');
const { callClaude } = require('../llm/claude');
const { logger } = require('../logger');

function estimateTokens(text = '') {
    return Math.ceil(String(text || '').length / 4);
}

function getAvailableProviders() {
    return [
        process.env.ANTHROPIC_API_KEY ? 'claude' : null,
        process.env.GROQ_API_KEY ? 'groq' : null,
        process.env.GEMINI_API_KEY ? 'gemini' : null,
    ].filter(Boolean);
}

async function callProvider(provider, systemPrompt, messages) {
    if (provider === 'claude') return callClaude(systemPrompt, messages);
    if (provider === 'gemini') return callGemini(systemPrompt, messages);
    return callGroq(systemPrompt, messages);
}

function sanitizeToolReply(reply) {
    return String(reply || '')
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 1600);
}

function parseSummaryLimit(text, fallback) {
    const match = String(text || '').match(/\b(\d{1,3})\b/);
    const requested = match ? Number(match[1]) : fallback;
    if (!Number.isFinite(requested)) return fallback;
    return Math.max(10, Math.min(requested, 120));
}

function formatGroupMessages(messages) {
    return messages
        .filter((message) => String(message.content || '').trim())
        .map((message) => {
            const time = message.timestamp
                ? new Date(Number(message.timestamp) * 1000).toISOString().slice(11, 16)
                : '--:--';
            const speaker = message.direction === 'out'
                ? 'EPLY/me'
                : (message.contact_name || 'Someone');
            const content = String(message.content || '').replace(/\s+/g, ' ').trim().slice(0, 400);
            return `[${time}] ${speaker}: ${content}`;
        })
        .join('\n');
}

async function summarizeGroup({ jid, text }) {
    const fallbackLimit = Number(getSetting('group_summary_default_limit') || process.env.GROUP_SUMMARY_DEFAULT_LIMIT || 40);
    const limit = parseSummaryLimit(text, fallbackLimit);
    const messages = getThread(jid, limit);
    const transcript = formatGroupMessages(messages);

    if (!transcript) {
        return 'No stored group messages yet. Turn on group message storage first, then try again after some chat.';
    }

    const providers = getAvailableProviders();
    if (!providers.length) {
        return 'No LLM key is configured yet, so I cannot summarize this group right now.';
    }

    const systemPrompt = [
        'You summarize WhatsApp group chats for the account owner.',
        'Be concise, useful, and neutral.',
        'Do not invent details.',
        'Return plain WhatsApp-friendly text only.',
        'Use this structure:',
        'Group recap:',
        '- Main points',
        '- Decisions or requests',
        '- Things the owner may need to reply to',
        'Keep it under 10 short lines.',
    ].join('\n');

    const messagesForLlm = [{
        role: 'user',
        content: `Summarize these recent group messages:\n\n${transcript}`,
    }];

    for (const provider of providers) {
        try {
            const reply = sanitizeToolReply(await callProvider(provider, systemPrompt, messagesForLlm));
            recordLlmUsage({
                jid,
                provider,
                model: provider,
                estimatedInput: estimateTokens(systemPrompt) + estimateTokens(messagesForLlm[0].content),
                estimatedOutput: estimateTokens(reply),
                estimatedTotal: estimateTokens(systemPrompt) + estimateTokens(messagesForLlm[0].content) + estimateTokens(reply),
            });
            return reply;
        } catch (err) {
            logger.warn('Group summary provider failed', { provider, err: err.message });
        }
    }

    return 'I tried to summarize this group, but the LLM providers failed. Check the logs/API keys.';
}

module.exports = { summarizeGroup };
