'use strict';

const express = require('express');
const router = express.Router();
const { getStatus } = require('../../whatsapp/connection');
const { getTodayStats, getSetting, setSetting, getFlagged } = require('../../db/queries');

router.get('/', (req, res) => {
    const stats = getTodayStats() || {};
    const autoReply = getSetting('auto_reply_enabled') !== 'false';
    const flaggedCount = getFlagged(false).length;
    res.render('home', {
        title: 'EPLY — Dashboard',
        waStatus: getStatus(),
        stats,
        autoReply,
        flaggedCount,
    });
});

router.patch('/toggle-auto-reply', (req, res) => {
    const current = getSetting('auto_reply_enabled') !== 'false';
    setSetting('auto_reply_enabled', current ? 'false' : 'true');
    res.json({ enabled: !current });
});

module.exports = router;
