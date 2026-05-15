'use strict';

const express = require('express');
const router = express.Router();
const { getAllSettings, setSetting } = require('../../db/queries');

router.get('/', (req, res) => {
    const settings = getAllSettings();
    res.render('settings', { title: 'EPLY — Settings', settings, saved: req.query.saved === '1' });
});

router.post('/', (req, res) => {
    const allowedKeys = [
        'default_model', 'notify_method', 'digest_time', 'digest_timezone',
        'urgency_keywords', 'log_level',
        'daily_reply_limit', 'daily_estimated_token_limit',
        'store_group_messages', 'group_features_enabled', 'group_mention_replies',
        'group_reply_to_me_replies', 'group_summary_enabled',
        'group_summary_default_limit', 'reply_style_guard',
    ];
    for (const key of allowedKeys) {
        if (req.body[key] !== undefined) {
            setSetting(key, req.body[key]);
        }
    }
    res.redirect('/settings?saved=1');
});

module.exports = router;
