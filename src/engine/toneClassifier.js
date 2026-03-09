'use strict';

/**
 * Tone Classifier — classifies incoming message into a tone context.
 * Used by promptBuilder to tailor the system prompt and by llmRouter
 * to select the right model.
 *
 * Returns one of:
 *   'casual' | 'work' | 'unknown' | 'emotional' | 'business' | 'banter' | 'sensitive'
 */

const SENSITIVE_PATTERNS = [
    /\b(money|lend|borrow|send me|transfer|r\d{2,5}|£\d+|\$\d+|legal|contract|lawyer|medical|doctor|hospital|sick|ill)\b/i,
];

const URGENCY_PATTERNS = [
    /\b(urgent|emergency|asap|call me|sos|please respond|i need help|are you ok)\b/i,
];

const EMOTIONAL_PATTERNS = [
    /\b(miss you|i'm sad|i'm hurt|crying|depressed|lonely|broken|scared|afraid|worried)\b/i,
];

const WORK_PATTERNS = [
    /\b(meeting|invoice|deadline|project|client|proposal|contract|deliverable|budget|schedule|availability)\b/i,
];

const BUSINESS_PATTERNS = [
    /\b(price|pricing|rates|quote|services?|how much|cost|package|what do you charge|enquir|inquiry|enquiry)\b/i,
];

const BANTER_PATTERNS = [
    /\b(lol|haha|😂|😅|🤣|rofl|bruh|😏|💀|😭|fr|no cap|dead)\b/i,
];

/**
 * @param {string} text
 * @param {Array} history — last messages in thread
 * @returns {string} tone context
 */
function classify(text, history = []) {
    if (!text) return 'casual';
    const t = text.toLowerCase();

    if (SENSITIVE_PATTERNS.some(p => p.test(t))) return 'sensitive';
    if (EMOTIONAL_PATTERNS.some(p => p.test(t))) return 'emotional';
    if (WORK_PATTERNS.some(p => p.test(t))) return 'work';
    if (BUSINESS_PATTERNS.some(p => p.test(t))) return 'business';
    if (BANTER_PATTERNS.some(p => p.test(t))) return 'banter';

    // If no history it's likely an unknown contact
    if (!history || history.length === 0) return 'unknown';

    return 'casual';
}

module.exports = { classify };
