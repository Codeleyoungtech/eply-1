'use strict';

/**
 * Urgency Detector — scores every incoming message for urgency.
 * High-urgency messages bypass the digest and trigger immediate pings.
 * Based on PRD §3.4.
 */

const { logger } = require('../logger');

// Map of jid → array of timestamps for follow-up detection
const followUpTracker = new Map();
const FOLLOW_UP_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const FOLLOW_UP_THRESHOLD = 3;

const URGENCY_KEYWORDS = [
    /\b(urgent|urgently)\b/i,
    /\b(emergency|emergencies)\b/i,
    /\b(asap|a\.s\.a\.p)\b/i,
    /\b(call me (now|please|urgently)?)\b/i,
    /\bsos\b/i,
    /\b(please|plz|pls)\b/i,
    /\b(i need help|need your help)\b/i,
    /\b(are you ok|are you okay|you okay|u ok)\b/i,
    /\b(please respond|please reply|respond please)\b/i,
    /\b(very important|super important|critical)\b/i,
];

const DISTRESS_KEYWORDS = [
    /\b(i'm crying|i'm scared|i'm hurt|i need you|please come|something happened)\b/i,
    /\b(accident|hospital|hurt|bleeding|danger|trapped)\b/i,
];

const FINANCIAL_LEGAL_KEYWORDS = [
    /\b(send me|lend me|transfer|r\d{2,5}|£\d+|\$\d+|pay me back|money)\b/i,
    /\b(contract|legal|lawyer|attorney|sue|court|lawsuit)\b/i,
];

/**
 * @param {object} opts
 * @param {string} opts.jid
 * @param {string} opts.text
 * @param {boolean} opts.isVip
 * @returns {{ urgent: boolean, financial: boolean, reason: string }}
 */
function detectUrgency({ jid, text, isVip }) {
    if (!text) return { urgent: false, financial: false, reason: 'no text' };
    const t = text.toLowerCase();

    // VIP — always urgent regardless of content
    if (isVip) {
        return { urgent: true, financial: false, reason: 'vip_contact' };
    }

    // Explicit urgency keywords
    if (URGENCY_KEYWORDS.some(p => p.test(t))) {
        return { urgent: true, financial: false, reason: 'urgency_keyword' };
    }

    // Distress language
    if (DISTRESS_KEYWORDS.some(p => p.test(t))) {
        return { urgent: true, financial: false, reason: 'distress_language' };
    }

    // Financial / legal — urgent + flagged
    if (FINANCIAL_LEGAL_KEYWORDS.some(p => p.test(t))) {
        return { urgent: true, financial: true, reason: 'financial_legal' };
    }

    // Follow-up detection — 3+ messages in 30 min with no reply
    const now = Date.now();
    if (!followUpTracker.has(jid)) followUpTracker.set(jid, []);
    const times = followUpTracker.get(jid);
    times.push(now);
    // Prune old entries
    const recent = times.filter(t => now - t < FOLLOW_UP_WINDOW_MS);
    followUpTracker.set(jid, recent);

    if (recent.length >= FOLLOW_UP_THRESHOLD) {
        logger.warn('Follow-up urgency detected', { jid, count: recent.length });
        return { urgent: true, financial: false, reason: 'follow_up_unanswered' };
    }

    return { urgent: false, financial: false, reason: 'normal' };
}

/** Call this when a reply is sent to reset the follow-up counter for a JID */
function resetFollowUp(jid) {
    followUpTracker.delete(jid);
}

module.exports = { detectUrgency, resetFollowUp };
