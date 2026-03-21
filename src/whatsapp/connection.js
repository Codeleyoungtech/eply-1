'use strict';

const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    jidNormalizedUser,
} = require('baileys');
const QRCode = require('qrcode');
const path = require('path');
const { logger } = require('../logger');
const { EventEmitter } = require('events');

// ── Silence Baileys / Signal Protocol console.log spam ───────────────────────
// The libsignal layer inside Baileys prints "Closing session: SessionEntry {...}"
// directly via console — this overrides it and filters those lines out.
const _origConsoleLog = console.log.bind(console);
const _origConsoleWarn = console.warn.bind(console);
const _origConsoleErr = console.error.bind(console);
const _baileysNoise = /Closing\s(session|open session)|SessionEntry|_chains|pendingPreKey|currentRatchet|registrationId/;

console.log = (...a) => { if (!_baileysNoise.test(String(a[0]))) _origConsoleLog(...a); };
console.warn = (...a) => { if (!_baileysNoise.test(String(a[0]))) _origConsoleWarn(...a); };
console.error = (...a) => { if (!_baileysNoise.test(String(a[0]))) _origConsoleErr(...a); };

// ────────────────────────────────────────────────────────────────────────────

const waEmitter = new EventEmitter();
waEmitter.setMaxListeners(20);

let sock = null;
let currentQrDataUrl = null;
let connectionStatus = 'disconnected'; // disconnected | connecting | connected

// Track IDs of messages WE sent — so we never reply to ourselves
const sentMessageIds = new Set();
const recentlyForwarded = new Map(); // key -> unix seconds

function getClient() { return sock; }
function getQrDataUrl() { return currentQrDataUrl; }
function getStatus() { return connectionStatus; }

// Cache the WA version — fetched ONCE, reused on every reconnect
// Without this, every reconnect makes an extra HTTP request → adds delay
let cachedVersion = null;
async function getVersion() {
    if (!cachedVersion) {
        const result = await fetchLatestBaileysVersion();
        cachedVersion = result.version;
        logger.info('WA version fetched', { version: cachedVersion });
    }
    return cachedVersion;
}

// Silent pino logger — suppresses ALL internal Baileys log noise
const pinoSilent = require('pino')({ level: 'silent' });

async function connectToWhatsApp() {
    const authDir = process.env.AUTH_DIR || path.join(process.cwd(), 'auth_info_baileys');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const version = await getVersion(); // cached — no HTTP round-trip on reconnects

    logger.info('Connecting to WhatsApp', { version });
    connectionStatus = 'connecting';

    sock = makeWASocket({
        version,
        auth: state,
        logger: pinoSilent,
        browser: ['EPLY', 'Chrome', '120.0.0'],
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,        // don't sync old messages — starts fast
        markOnlineOnConnect: false,    // keeps last-active timestamp clean
        keepAliveIntervalMs: 25_000,   // ping WA every 25s to prevent 408 timeouts
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            currentQrDataUrl = await QRCode.toDataURL(qr);
            logger.info('QR code generated — visit http://localhost:3000/qr');
            waEmitter.emit('qr', currentQrDataUrl);
        }

        if (connection === 'open') {
            connectionStatus = 'connected';
            currentQrDataUrl = null;
            logger.info('WhatsApp connected ✅', { myNumber: sock.user?.id });
            waEmitter.emit('connected');
        }

        if (connection === 'close') {
            connectionStatus = 'disconnected';
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            logger.warn('WhatsApp disconnected', { statusCode, shouldReconnect });
            waEmitter.emit('disconnected', statusCode);
            if (shouldReconnect) {
                const delay = statusCode === 408 ? 10000 : 5000; // wait longer on timeout
                logger.info(`Reconnecting in ${delay / 1000}s...`);
                setTimeout(connectToWhatsApp, delay);
            } else {
                // Logged out — delete auth so next boot shows a fresh QR
                logger.error('WhatsApp logged out — delete auth_info_baileys/ and restart to re-pair');
            }
        }
    });

    // ── Message listener ─────────────────────────────────────────────────────
    const sessionStartTime = Date.now() / 1000 - 30; // ignore anything older than 30s
    const recentlyForwarded = new Map();

    sock.ev.on('messages.upsert', ({ messages, type }) => {
        // Only 'notify' = new real-time message. 'append' = history batch — skip.
        if (type !== 'notify') return;
        logger.debug('messages.upsert fired', { type, count: messages.length });

        for (const msg of messages) {
            const ts = Number(msg.messageTimestamp || 0);
            const id = msg.key?.id || '';
            const remote = msg.key?.remoteJid || '';
            const dedupeKey = `${remote}:${id}`;

            // ── LOOP GUARD: skip messages EPLY itself sent ─────────────────
            if (id && sentMessageIds.has(id)) {
                logger.debug('Skipping our own sent message', { id });
                continue;
            }

            // Drop duplicates across multiple upsert batches for same message
            const now = Math.floor(Date.now() / 1000);
            if (id && recentlyForwarded.has(dedupeKey)) continue;
            if (id) recentlyForwarded.set(dedupeKey, now);

            // Clean up dedupe map (10-min TTL)
            for (const [k, seenAt] of recentlyForwarded.entries()) {
                if (now - seenAt > 600) recentlyForwarded.delete(k);
            }

            // Drop historical messages synced at boot
            if (ts > 0 && ts < sessionStartTime) {
                logger.debug('Ignoring historical message', { ts });
                continue;
            }

            logger.debug('Forwarding message to handler', {
                id, from: remote, fromMe: msg.key?.fromMe,
            });

            waEmitter.emit('message', msg);
        }
    });

    return sock;
}

/**
 * Send a text message via the active WhatsApp socket.
 * Tracks the sent message ID to prevent the bot from replying to itself.
 */
async function sendMessage(jid, text) {
    if (!sock) throw new Error('WhatsApp not connected');
    const result = await sock.sendMessage(jid, { text });
    const msgId = result?.key?.id;
    if (msgId) {
        sentMessageIds.add(msgId);
        setTimeout(() => sentMessageIds.delete(msgId), 30_000); // auto-clean after 30s
    }
    logger.debug('Message sent', { jid, msgId, preview: text.slice(0, 60) });
}

module.exports = { connectToWhatsApp, getClient, getQrDataUrl, getStatus, sendMessage, waEmitter };
