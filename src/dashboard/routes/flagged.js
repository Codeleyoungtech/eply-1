'use strict';

const express = require('express');
const router = express.Router();
const { getFlagged, getFlaggedById, markHandled, saveMessage, updateFlaggedReply } = require('../../db/queries');
const { sendMessage } = require('../../whatsapp/connection');

router.get('/', (req, res) => {
    const showAll = req.query.all === '1';
    const items = getFlagged(!showAll ? false : undefined);
    res.render('flagged', { title: 'EPLY — Flagged', items, showAll });
});

router.post('/:id/handled', (req, res) => {
    markHandled(req.params.id);
    res.redirect('/flagged');
});

router.post('/:id/send', async (req, res) => {
    const item = getFlaggedById(req.params.id);
    if (!item) return res.redirect('/flagged');
    const reply = String(req.body.reply || item.eply_reply || '').trim();
    if (!reply) return res.redirect('/flagged');

    try {
        await sendMessage(item.jid, reply);
        updateFlaggedReply(item.id, reply);
        markHandled(item.id);
        saveMessage({
            jid: item.jid,
            contactName: item.contact_name,
            direction: 'out',
            content: reply,
            llmUsed: 'approved',
            isGroup: item.jid.endsWith('@g.us'),
        });
    } catch (err) {
        // Keep it unhandled so it remains visible for retry.
    }

    res.redirect('/flagged');
});

module.exports = router;
