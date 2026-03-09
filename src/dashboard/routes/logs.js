'use strict';

const express = require('express');
const router = express.Router();
const { logEmitter } = require('../../logger');

router.get('/', (req, res) => {
    res.render('logs', { title: 'EPLY — Live Logs' });
});

// Server-Sent Events stream
router.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const onLog = (entry) => {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
    };

    logEmitter.on('log', onLog);

    res.write(`data: ${JSON.stringify({ level: 'info', message: 'Log stream connected', timestamp: new Date().toISOString() })}\n\n`);

    req.on('close', () => {
        logEmitter.off('log', onLog);
    });
});

module.exports = router;
