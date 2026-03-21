'use strict';

/**
 * Reply Rules Engine — the brain that decides whether and how to reply.
 * All rules are HARDCODED — the LLM is only called for text generation.
 * Based on PRD §3 (DM rules, group rules, VIP guard, urgency detection).
 *
 * Returns an action object:
 *   { action: 'reply' | 'vague_flag' | 'silent' | 'ping_only', reason, ... }
 */

const { isVip } = require('../db/queries');
const { detectUrgency } = require('./urgencyDetector');
const { logger } = require('../logger');

// Spam signals (rough heuristics)
const SPAM_PATTERNS = [
    /\b(congratulations|you('ve| have) won|click here|claim your|prize|promotion|offer|100%|limited time|free gift|whatsapp (broadcast|channel))\b/i,
];

const GM_PATTERNS = [
    /^(gm|good morning|morning|gm!|good morning!|morning!|🌞|☀️|🌅)\.?$/i,
];

/**
 * Determines what to do with an incoming WhatsApp message.
 *
 * @param {object} opts
 * @param {string}  opts.jid            — sender JID
 * @param {string}  opts.phone          — sender phone (digits only)
 * @param {string}  opts.text           — message text
 * @param {boolean} opts.isGroup        — is this a group message
 * @param {boolean} opts.mentionedMe    — am I @mentioned (name or number)?
 * @param {boolean} opts.replyToMe      — is this a reply to one of my messages?
 * @param {string}  opts.adminNumber    — ADMIN_NUMBER (my number)
 * @param {boolean} opts.autoReplyEnabled
 * @returns {object} action
 */
function applyReplyRules({ jid, phone, text, isGroup, mentionedMe, replyToMe, adminNumber, autoReplyEnabled }) {
    const vip = isVip(phone);

    // ── 1. Auto-reply master toggle ────────────────────────────────────────────
    if (!autoReplyEnabled) {
        logger.debug('Auto-reply disabled — silencing', { jid });
        return { action: 'silent', reason: 'auto_reply_disabled' };
    }

    // ── 2. Spam detection ──────────────────────────────────────────────────────
    if (text && SPAM_PATTERNS.some(p => p.test(text))) {
        logger.debug('Spam detected — silencing', { jid });
        return { action: 'silent', reason: 'spam' };
    }

    // ── 3. VIP Guard ─────────────────────────────────────────────────────────
    if (vip) {
        const urgency = detectUrgency({ jid, text, isVip: true });
        if (urgency.urgent) {
            return { action: 'ping_only', reason: 'vip_urgent', isVip: true };
        }
        return { action: 'silent', reason: 'vip_contact', isVip: true };
    }

    // ── 4. Group chat rules ───────────────────────────────────────────────────
    if (isGroup) {
        // GM = always silent in groups
        if (text && GM_PATTERNS.some(p => p.test(text.trim()))) {
            return { action: 'silent', reason: 'group_gm' };
        }
        // Default group scope: reply only when explicitly tagged unless overridden.
        if (!mentionedMe && process.env.ALLOW_GROUP_UNTAGGED_AI !== 'true') {
            return { action: 'silent', reason: 'group_no_trigger' };
        }
        // We ARE needed — fall through to reply logic
        logger.debug('Group trigger fired — will reply', { jid, mentionedMe, replyToMe });
    }

    // ── 5. Urgency detection (for DMs) ───────────────────────────────────────
    const urgency = detectUrgency({ jid, text, isVip: false });
    if (urgency.financial) {
        return { action: 'reply', reason: 'financial_legal', urgency };
    }

    // ── 6. Sensitive topics direct check (backup to tone classifier) ──────────
    // Handled at reply generation level — tone classifier + vague reply logic.

    // ── 7. Default — proceed to auto-reply ───────────────────────────────────
    return { action: 'reply', reason: 'normal', urgency };
}

module.exports = { applyReplyRules };
