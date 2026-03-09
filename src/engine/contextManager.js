'use strict';

const { getThread } = require('../db/queries');

/**
 * Context Manager — retrieves the last N messages in a thread for prompt injection.
 * Keeps conversation continuity so EPLY remembers what was already said.
 */

/**
 * @param {string} jid
 * @param {number} limit — default 15 (PRD spec)
 * @returns {Array<{direction: string, content: string}>}
 */
function getConversationContext(jid, limit = 15) {
    return getThread(jid, limit);
}

module.exports = { getConversationContext };
