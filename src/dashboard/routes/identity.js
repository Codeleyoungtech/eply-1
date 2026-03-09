'use strict';

const express = require('express');
const router = express.Router();
const { getIdentity, saveIdentity } = require('../../db/queries');

router.get('/', (req, res) => {
    const identity = getIdentity();
    res.render('identity', { title: 'EPLY — Identity', identity, saved: req.query.saved === '1' });
});

router.post('/', (req, res) => {
    const fields = {
        full_name: req.body.full_name,
        nickname: req.body.nickname,
        location: req.body.location,
        timezone: req.body.timezone,
        what_i_do: req.body.what_i_do,
        vibe: req.body.vibe,
        real_examples: req.body.real_examples,
        schedule: req.body.schedule,
        projects: req.body.projects,
        interests: req.body.interests,
        off_limits: req.body.off_limits,
        reply_length: req.body.reply_length,
        emoji_use: req.body.emoji_use,
        slang: req.body.slang,
        never_say: req.body.never_say,
        punctuation: req.body.punctuation,
    };
    // Remove undefined/empty fields
    Object.keys(fields).forEach(k => { if (!fields[k]) delete fields[k]; });
    saveIdentity(fields);
    res.redirect('/identity?saved=1');
});

module.exports = router;
