'use strict';

const express = require('express');
const router = express.Router();
const { getStatus } = require('../../whatsapp/connection');
const { getDbPath } = require('../../config/paths');
const fs = require('fs');

router.get('/', (req, res) => {
    let dbSize = '?';
    try {
        const dbPath = getDbPath();
        const stat = fs.statSync(dbPath);
        dbSize = `${(stat.size / 1024).toFixed(1)} KB`;
    } catch { }

    res.json({
        status: 'ok',
        wa: getStatus(),
        db: dbSize,
        uptime: process.uptime().toFixed(0) + 's',
        ts: new Date().toISOString(),
    });
});

module.exports = router;
