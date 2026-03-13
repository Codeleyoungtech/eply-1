'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');

const { logger } = require('./src/logger');
const { initDb } = require('./src/db/schema');
const { createApp } = require('./src/dashboard/app');
const { connectToWhatsApp, waEmitter } = require('./src/whatsapp/connection');
const { handleMessage } = require('./src/whatsapp/messageHandler');
const { startDigestCron, startRetryWorker } = require('./src/queue/workers');

async function boot() {
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('⚡  EPLY — Your AI Self on WhatsApp');
    logger.info('    Responds as you. Sounds like you. Never sleeps.');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // ── 1. Ensure /data dir exists (Railway Volume) ────────────────────────
    const dbPath = process.env.DB_PATH || '/data/eply.db';
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    // Ensure logs dir exists
    if (!fs.existsSync('logs')) {
        fs.mkdirSync('logs', { recursive: true });
    }

    // ── 2. Init database ───────────────────────────────────────────────────
    initDb();

    // ── 3. Start Express dashboard ─────────────────────────────────────────
    const app = createApp();
    const port = parseInt(process.env.PORT || process.env.DASHBOARD_PORT || '3000', 10);
    app.listen(port, '0.0.0.0', () => {
        logger.info(`Dashboard running at http://0.0.0.0:${port}`);
    });

    // ── 4. Start BullMQ workers ────────────────────────────────────────────
    try {
        startRetryWorker();
        startDigestCron();
        logger.info('Queue workers and digest cron started');
    } catch (err) {
        logger.warn('Redis not available — digest cron and queue workers disabled', { err: err.message });
        logger.warn('Tip: Add a Redis service on Railway for full functionality');
    }

    // ── 5. Connect to WhatsApp ─────────────────────────────────────────────
    await connectToWhatsApp();

    // ── 6. Wire message handler ────────────────────────────────────────────
    waEmitter.on('message', handleMessage);

    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('✅  EPLY is running');
    logger.info(`    AUTO_REPLY: ${process.env.AUTO_REPLY_ENABLED === 'true' ? '🟢 ENABLED' : '🔴 DISABLED (safe mode)'}`);
    logger.info('    Visit the dashboard to configure your identity');
    logger.info('    Visit /qr to connect WhatsApp if not yet connected');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // ── 7. Graceful shutdown ───────────────────────────────────────────────
    process.on('SIGTERM', () => {
        logger.info('SIGTERM received — shutting down gracefully');
        process.exit(0);
    });
    process.on('SIGINT', () => {
        logger.info('SIGINT received — shutting down');
        process.exit(0);
    });
    process.on('uncaughtException', (err) => {
        logger.error('Uncaught exception', { err: err.message, stack: err.stack });
    });
    process.on('unhandledRejection', (reason) => {
        logger.error('Unhandled rejection', { reason: String(reason) });
    });
}

boot().catch(err => {
    console.error('Fatal boot error:', err);
    process.exit(1);
});
