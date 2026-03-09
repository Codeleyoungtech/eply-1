'use strict';

/**
 * Digest cron worker — fires the daily digest at the configured time.
 * Uses node-cron for timezone-aware scheduling.
 * BullMQ retry worker is optional — only starts if Redis is available.
 */

const cron = require('node-cron');
const { buildAndSendDigest } = require('../engine/digestBuilder');
const { getSetting } = require('../db/queries');
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

module.exports = { startDigestCron, startRetryWorker };
