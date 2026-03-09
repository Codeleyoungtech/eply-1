'use strict';

/**
 * Memory Manager — extracts and stores facts about contacts after conversations.
 * Minimalistic: stores explicit facts (name, location, relationship etc.) extracted
 * from messages. Full memory query for prompt injection.
 */

const { saveFact, getMemories } = require('../db/queries');
const { logger } = require('../logger');

// Simple heuristic fact extractor (no LLM round-trip on every message)
const FACT_PATTERNS = [
    { regex: /my name is ([A-Z][a-z]+)/i, template: m => `Contact's name is ${m[1]}` },
    { regex: /i('m| am) from ([A-Za-z ]+)/i, template: m => `Contact is from ${m[2]}` },
    { regex: /i('m| am) (\d+) years? old/i, template: m => `Contact is ${m[2]} years old` },
    { regex: /i work (at|for|in) ([^.!?]+)/i, template: m => `Contact works at ${m[2]}` },
    { regex: /i('m| am) (a|an) ([A-Za-z ]+)/i, template: m => `Contact is a ${m[3]}` },
    { regex: /i live in ([A-Za-z ]+)/i, template: m => `Contact lives in ${m[1]}` },
];

/**
 * Extracts facts from an incoming message and stores them.
 * Called after every incoming DM.
 */
function extractAndStore(jid, contactName, text) {
    if (!text) return;
    for (const { regex, template } of FACT_PATTERNS) {
        const m = text.match(regex);
        if (m) {
            const fact = template(m);
            saveFact({ jid, contactName, fact, sourceMsg: text.slice(0, 200) });
            logger.debug('Memory stored', { jid, fact });
        }
    }
}

/**
 * Retrieve all stored facts for a contact.
 * @returns {Array<{fact: string}>}
 */
function getContactMemories(jid) {
    return getMemories(jid);
}

module.exports = { extractAndStore, getContactMemories };
