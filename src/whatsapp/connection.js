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

function getClient() { return sock; }
function getQrDataUrl() { return currentQrDataUrl; }
function getStatus() { return connectionStatus; }

async function connectToWhatsApp() {
    const authDir = path.join(process.cwd(), 'auth_info_baileys');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    logger.info('Connecting to WhatsApp', { version });
    connectionStatus = 'connecting';

    // pino with level 'silent' kills ALL internal Baileys log output
    const makeSilentLogger = () => {
        const pino = require('pino');
        return pino({ level: 'silent' });
    };

    sock = makeWASocket({
        version,
        auth: state,
        logger: makeSilentLogger(),
        browser: ['EPLY', 'Chrome', '120.0.0'],
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,        // don't waste time syncing old messages
        markOnlineOnConnect: false,    // don't mark as online (keeps last-active clean)
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

    sock.ev.on('messages.upsert', ({ messages, type }) => {
        logger.debug('messages.upsert fired', { type, count: messages.length });

        if (type !== 'notify') return; // 'append' = historical batch, skip it

        for (const msg of messages) {
            const ts = Number(msg.messageTimestamp || 0);

            // Drop historical messages synced at boot
            if (ts > 0 && ts < sessionStartTime) {
                logger.debug('Ignoring historical message', { ts, sessionStart: sessionStartTime });
                continue;
            }

            logger.debug('Forwarding message to handler', {
                id: msg.key?.id,
                from: msg.key?.remoteJid,
                fromMe: msg.key?.fromMe,
            });

            waEmitter.emit('message', msg);
        }
    });

    return sock;
}

/**
 * Send a text message via the active WhatsApp socket.
 */
async function sendMessage(jid, text) {
    if (!sock) throw new Error('WhatsApp not connected');
    await sock.sendMessage(jid, { text });
    logger.debug('Message sent', { jid, preview: text.slice(0, 60) });
}

module.exports = { connectToWhatsApp, getClient, getQrDataUrl, getStatus, sendMessage, waEmitter };
