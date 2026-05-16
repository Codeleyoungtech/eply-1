'use strict';

/**
 * Digest cron worker — fires the daily digest at the configured time.
 * Uses node-cron for timezone-aware scheduling.
 * BullMQ retry worker is optional — only starts if Redis is available.
 */

const cron = require('node-cron');
const { buildAndSendDigest } = require('../engine/digestBuilder');
const { getDueReminders, getSetting, markReminderDelivered } = require('../db/queries');
const { sendMessage } = require('../whatsapp/connection');
const { logger } = require('../logger');

function startDigestCron() {
    const digestTime = process.env.DIGEST_TIME || getSetting('digest_time') || '07:00';
    const tz = process.env.DIGEST_TIMEZONE || getSetting('digest_timezone') || 'Africa/Johannesburg';

    const [hour, minute] = digestTime.split(':');
    const cronExpr = `${minute} ${hour} * * *`;

    logger.info('Digest cron scheduled', { cronExpr, timezone: tz });

    cron.schedule(cronExpr, async () => {
        logger.info('Digest cron fired');
        try {
            await buildAndSendDigest();
        } catch (err) {
            logger.error('Digest cron error', { err: err.message });
        }
    }, { timezone: tz });
}

function startReminderWorker() {
    setInterval(async () => {
        const due = getDueReminders();
        for (const reminder of due) {
            try {
                await sendMessage(reminder.jid, `Reminder: ${reminder.text}`);
                markReminderDelivered(reminder.id);
                logger.info('Reminder delivered', { id: reminder.id, jid: reminder.jid });
            } catch (err) {
                logger.warn('Reminder delivery failed', { id: reminder.id, err: err.message });
            }
        }
    }, 30_000);
    logger.info('Reminder worker started');
}

function startRetryWorker() {
    // Only start if Redis is available
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        logger.info('No REDIS_URL — retry worker skipped (digest cron still runs)');
        return;
    }

    try {
        const { Worker } = require('bullmq');
        const { getRedisConnection } = require('./bullmq');
        const worker = new Worker('retry', async job => {
            logger.info('Retry job running', { id: job.id });
        }, { connection: getRedisConnection() });

        worker.on('failed', (job, err) => {
            logger.error('Retry job failed', { id: job?.id, err: err.message });
        });
        logger.info('BullMQ retry worker started');
    } catch (err) {
        logger.warn('BullMQ retry worker failed to start', { err: err.message });
    }
}

module.exports = { startDigestCron, startRetryWorker, startReminderWorker };
