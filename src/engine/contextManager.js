'use strict';

const { getThread } = require('../db/queries');

/**
 * Context Manager — retrieves the last N messages in a thread for prompt injection.
 * Keeps conversation continuity so EPLY remembers what was already said.
 */

/**
 * Builds a compact summary from older messages so we keep context
 * without sending the full thread to the LLM.
 */
function buildConversationSummary(messages, maxItems = 8, maxSnippet = 90) {
    const usable = messages
        .filter((message) => (message.content || '').trim())
        .slice(-maxItems)
        .map((message) => {
            const role = message.direction === 'out' ? 'You' : 'Contact';
            const snippet = String(message.content || '').replace(/\s+/g, ' ').trim().slice(0, maxSnippet);
            return `${role}: ${snippet}`;
        });

    if (!usable.length) return null;
    return `Earlier in this conversation: ${usable.join(' | ')}`;
}

/**
 * @param {string} jid
 * @param {object} opts
 * @param {number} opts.fullWindow
 * @param {number} opts.summaryThreshold
 * @param {number} opts.fetchLimit
 * @returns {{recent: Array<{direction: string, content: string}>, summary: string|null}}
 */
function getConversationContext(jid, opts = {}) {
    const fullWindow = opts.fullWindow || 12;
    const summaryThreshold = opts.summaryThreshold || 30;
    const fetchLimit = opts.fetchLimit || Math.max(summaryThreshold + fullWindow, 60);

    const thread = getThread(jid, fetchLimit);
    if (thread.length <= summaryThreshold) {
        return {
            recent: thread.slice(-fullWindow),
            summary: null,
        };
    }

    const older = thread.slice(0, -fullWindow);
    const recent = thread.slice(-fullWindow);

    return {
        recent,
        summary: buildConversationSummary(older),
    };
}

module.exports = { getConversationContext };
