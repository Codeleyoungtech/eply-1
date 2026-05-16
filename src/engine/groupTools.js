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

function parseLimit(text, fallback) {
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

async function runThreadTool({ jid, text, tool = 'summary', isGroup = false }) {
    const fallbackLimit = Number(getSetting('group_summary_default_limit') || process.env.GROUP_SUMMARY_DEFAULT_LIMIT || 40);
    const limit = parseLimit(text, fallbackLimit);
    const messages = getThread(jid, limit);
    const transcript = formatGroupMessages(messages);

    if (!transcript) {
        return isGroup
            ? 'No stored group messages yet. Turn on group message storage first, then try again after some chat.'
            : 'No stored messages in this chat yet.';
    }

    const providers = getAvailableProviders();
    if (!providers.length) {
        return 'No LLM key is configured yet, so I cannot summarize this group right now.';
    }

    const toolInstructions = {
        summary: [
            'Return a useful recap.',
            'Use this structure:',
            'Recap:',
            '- Main points',
            '- Decisions or requests',
            '- Things the owner may need to reply to',
            'Keep it under 10 short lines.',
        ],
        todo: [
            'Extract action items, tasks, promises, follow-ups, deadlines, and owners.',
            'Use this structure:',
            'Tasks:',
            '- Task - owner - deadline/status',
            'If there are no clear tasks, say "No clear tasks found."',
        ],
        decisions: [
            'Extract decisions, agreements, conclusions, and open questions.',
            'Use this structure:',
            'Decisions:',
            '- Decision/agreement',
            'Open questions:',
            '- Question',
            'If none are clear, say so briefly.',
        ],
        catchup: [
            'Explain what the owner missed and what needs attention.',
            'Use this structure:',
            'Catch-up:',
            '- What happened',
            '- Needs your attention',
            '- Suggested reply if useful',
        ],
        query: [
            'Answer the owner\'s specific question about this chat history.',
            'Use only the transcript. If the answer is not in the transcript, say so.',
            'Keep it concise and include who said it when useful.',
        ],
    }[tool] || ['Return a concise useful analysis of the chat.'];

    const systemPrompt = [
        'You analyze WhatsApp chats for the account owner.',
        'Be concise, useful, and neutral.',
        'Do not invent details.',
        'Return plain WhatsApp-friendly text only.',
        ...toolInstructions,
    ].join('\n');

    const messagesForLlm = [{
        role: 'user',
        content: `Request: ${String(text || '').replace(/^!\w+\s*/i, '').trim() || tool}\n\nRecent WhatsApp messages:\n\n${transcript}`,
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
            logger.warn('Chat tool provider failed', { provider, tool, err: err.message });
        }
    }

    return 'I tried to run that chat tool, but the LLM providers failed. Check the logs/API keys.';
}

async function runTextTool({ jid, text, tool }) {
    const payload = String(text || '').replace(/^!\w+\s*/i, '').trim();
    if (!payload) return null;

    const providers = getAvailableProviders();
    if (!providers.length) {
        return 'No LLM key is configured yet, so I cannot run that tool right now.';
    }

    const instructions = {
        ask: 'Answer the user clearly and concisely. Plain WhatsApp text only.',
        explain: 'Explain the text in simple, clear language. If it is confusing, clarify the likely meaning. Plain WhatsApp text only.',
        draft: 'Draft a natural reply to this message in the account owner\'s voice. Return only the reply text.',
        brain: 'Clean this brain dump into a short note with tags. Use this format: Title: ...\\nTags: ...\\nNote: ...',
        post: 'Turn the idea into a polished LinkedIn-style post. Keep it natural and not too long.',
        thread: 'Turn the idea into a concise X/Twitter thread with numbered posts.',
        caption: 'Turn the idea into a punchy social media caption with a few tasteful hashtags.',
        script: 'Turn the idea into a short video script with hook, body, and CTA.',
        rewrite: 'Rewrite the text to sound natural, clear, and WhatsApp-friendly. Return only the rewritten text.',
        polish: 'Polish the text while keeping the meaning and voice. Return only the polished text.',
        formal: 'Rewrite the text in a respectful, professional tone. Return only the rewritten text.',
        casual: 'Rewrite the text in a relaxed, natural WhatsApp tone. Return only the rewritten text.',
        translate: 'Translate the text. If a target language is named at the start, use it. Return only the translation.',
        short: 'Make the text shorter without losing the key meaning. Return only the shortened text.',
        bullets: 'Turn the text into concise bullet points. Keep only the useful points.',
    }[tool] || 'Help with the text. Return only the useful output.';

    const systemPrompt = [
        'You are a private WhatsApp utility for the account owner.',
        instructions,
        'Do not mention that you are an AI.',
    ].join('\n');

    const messagesForLlm = [{ role: 'user', content: payload }];

    for (const provider of providers) {
        try {
            const reply = sanitizeToolReply(await callProvider(provider, systemPrompt, messagesForLlm));
            recordLlmUsage({
                jid,
                provider,
                model: provider,
                estimatedInput: estimateTokens(systemPrompt) + estimateTokens(payload),
                estimatedOutput: estimateTokens(reply),
                estimatedTotal: estimateTokens(systemPrompt) + estimateTokens(payload) + estimateTokens(reply),
            });
            return reply;
        } catch (err) {
            logger.warn('Text tool provider failed', { provider, tool, err: err.message });
        }
    }

    return 'I tried to run that text tool, but the LLM providers failed. Check the logs/API keys.';
}

module.exports = { runTextTool, runThreadTool };
