'use strict';

const express = require('express');
const router = express.Router();
const { getDigests } = require('../../db/queries');
const { buildAndSendDigest } = require('../../engine/digestBuilder');

router.get('/', (req, res) => {
    const digests = getDigests(30);
    res.render('digest', { title: 'EPLY — Digest History', digests, req });
});

// Manual trigger (useful for testing)
router.post('/trigger', async (req, res) => {
    try {
        await buildAndSendDigest();
        res.redirect('/digest?triggered=1');
    } catch (err) {
        res.redirect('/digest?error=1');
    }
});

module.exports = router;
