'use strict';

/**
 * BullMQ setup — creates shared queues backed by Redis.
 * Redis connection is LAZY — it only connects when a queue is actually used.
 * This means the app boots cleanly even without Redis available locally.
 */

const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const { logger } = require('../logger');

let connection = null;
let digestQueue = null;
let retryQueue = null;

function getRedisConnection() {
    if (!connection) {
        const url = process.env.REDIS_URL || 'redis://localhost:6379';
        connection = new IORedis(url, {
            maxRetriesPerRequest: null,
            lazyConnect: true,           // don't connect until first command
            enableOfflineQueue: false,   // fail fast instead of queueing
            retryStrategy: (times) => {
                if (times > 3) return null; // give up after 3 attempts
                return Math.min(times * 1000, 5000);
            },
        });
        connection.on('connect', () => logger.info('Redis connected'));
        connection.on('error', err => logger.warn('Redis unavailable — queue features disabled', { err: err.message }));
    }
    return connection;
}

function getDigestQueue() {
    if (!digestQueue) {
        digestQueue = new Queue('digest', { connection: getRedisConnection() });
    }
    return digestQueue;
}

function getRetryQueue() {
    if (!retryQueue) {
        retryQueue = new Queue('retry', { connection: getRedisConnection() });
    }
    return retryQueue;
}

module.exports = { getDigestQueue, getRetryQueue, getRedisConnection };
