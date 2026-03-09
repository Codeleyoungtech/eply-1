'use strict';

/**
 * Notifier — routes urgent pings and daily digests to the configured channel.
 * Supports: self_chat | secondary_number | telegram | dashboard
 * Based on PRD §4.2 and §4.3.
 */

const { sendMessage } = require('../whatsapp/connection');
const { logger } = require('../logger');

/**
 * Sends a real-time urgent ping to the notify channel.
 * @param {object} opts
 * @param {string} opts.contactName
 * @param {string} opts.theirMsg
 * @param {string} opts.eplyReply   — what EPLY replied (or null if VIP/silent)
 * @param {string} opts.reason      — urgency reason code
 * @param {boolean} opts.isVip
 */
async function sendUrgentPing({ contactName, theirMsg, eplyReply, reason, isVip }) {
    const method = process.env.NOTIFY_METHOD || 'self_chat';
    const notifyNumber = process.env.NOTIFY_NUMBER || process.env.ADMIN_NUMBER;

    const emoji = isVip ? '🔴' : '⚠️';
    const tag = isVip ? 'VIP URGENT' : 'FLAGGED';
    const replyLine = eplyReply
        ? `\nEPLY replied: "${eplyReply.slice(0, 100)}"`
        : '\n→ Not auto-replied.';

    const text = `${emoji} EPLY ${tag}
From: ${contactName || 'Unknown'}
Msg: "${(theirMsg || '').slice(0, 150)}"${replyLine}
Reason: ${reason}
${isVip ? '→ Reply yourself — VIP contact.' : '→ Review when you can.'}`;

    await _send(method, notifyNumber, text);
}

/**
 * Sends the daily digest to the notify channel.
 * @param {string} digestText
 */
async function sendDigest(digestText) {
    const method = process.env.NOTIFY_METHOD || 'self_chat';
    const notifyNumber = process.env.NOTIFY_NUMBER || process.env.ADMIN_NUMBER;
    await _send(method, notifyNumber, digestText);
}

async function _send(method, notifyNumber, text) {
    if (method === 'dashboard') {
        logger.info('Notification (dashboard-only) — not sending via WA', { preview: text.slice(0, 60) });
        return;
    }

    if (method === 'telegram') {
        await sendViaTelegram(text);
        return;
    }

    // self_chat or secondary_number — both send a WhatsApp message
    if (!notifyNumber) {
        logger.warn('NOTIFY_NUMBER not set — cannot send notification');
        return;
    }
    const jid = `${notifyNumber}@s.whatsapp.net`;
    try {
        await sendMessage(jid, text);
        logger.info('Notification sent via WhatsApp', { method, jid });
    } catch (err) {
        logger.error('Failed to send notification via WhatsApp', { err: err.message });
    }
}

async function sendViaTelegram(text) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
        logger.warn('Telegram not configured — TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing');
        return;
    }
    try {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        });
        if (!res.ok) logger.error('Telegram send failed', { status: res.status });
        else logger.info('Notification sent via Telegram');
    } catch (err) {
        logger.error('Telegram request failed', { err: err.message });
    }
}

module.exports = { sendUrgentPing, sendDigest };
