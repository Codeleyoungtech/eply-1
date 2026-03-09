'use strict';

/**
 * Groq LLM Client — fast path for ~80% of DM replies.
 * Model: llama-3.3-70b-versatile
 */

const Groq = require('groq-sdk');
const { logger } = require('../logger');

let groqClient;

function getGroqClient() {
    if (!groqClient) {
        groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    }
    return groqClient;
}

/**
 * @param {string} systemPrompt
 * @param {Array}  messages     — [{role, content}]
 * @returns {string} reply text
 */
async function callGroq(systemPrompt, messages) {
    const client = getGroqClient();
    const response = await client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
        ],
        temperature: 0.85,
        max_tokens: 300,
        top_p: 0.95,
    });

    const reply = response.choices[0]?.message?.content?.trim();
    if (!reply) throw new Error('Groq returned empty response');
    logger.debug('Groq reply generated', { tokens: response.usage?.total_tokens });
    return reply;
}

module.exports = { callGroq };
