'use strict';

/**
 * Claude LLM Client — reasoning path for complex, sensitive, work queries.
 * Model: claude-sonnet-4-5
 */

const Anthropic = require('@anthropic-ai/sdk');
const { logger } = require('../logger');

let claudeClient;

function getClaudeClient() {
    if (!claudeClient) {
        claudeClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return claudeClient;
}

/**
 * @param {string} systemPrompt
 * @param {Array}  messages     — [{role, content}]
 * @returns {string} reply text
 */
async function callClaude(systemPrompt, messages) {
    const client = getClaudeClient();
    const response = await client.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 220,
        system: systemPrompt,
        messages: messages.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
        })),
    });

    const reply = response.content[0]?.text?.trim();
    if (!reply) throw new Error('Claude returned empty response');
    logger.debug('Claude reply generated', { tokens: response.usage?.output_tokens });
    return reply;
}

module.exports = { callClaude };
