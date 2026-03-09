'use strict';

const { createLogger, format, transports } = require('winston');
const path = require('path');
const { EventEmitter } = require('events');

// SSE emitter — dashboard /logs/stream subscribes to this
const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(50);

// Custom Winston transport for SSE streaming
class SseTransport extends require('winston-transport') {
    constructor(opts) {
        super(opts);
    }
    log(info, callback) {
        setImmediate(() => {
            logEmitter.emit('log', {
                level: info.level,
                message: info.message,
                timestamp: info.timestamp,
            });
        });
        callback();
    }
}

const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.errors({ stack: true }),
        format.splat(),
        format.json()
    ),
    transports: [
        new transports.Console({
            format: format.combine(
                format.colorize(),
                format.printf(({ timestamp, level, message, ...meta }) => {
                    const extra = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
                    return `[${timestamp}] ${level}: ${message}${extra}`;
                })
            ),
        }),
        new SseTransport({ level: 'debug' }),
    ],
});

// In production we also write to files
if (process.env.NODE_ENV === 'production') {
    logger.add(
        new transports.File({
            filename: path.join(process.cwd(), 'logs', 'error.log'),
            level: 'error',
        })
    );
    logger.add(
        new transports.File({
            filename: path.join(process.cwd(), 'logs', 'combined.log'),
        })
    );
}

module.exports = { logger, logEmitter };
