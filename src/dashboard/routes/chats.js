'use strict';

const express = require('express');
const router = express.Router();
const { getAllChats, getThread, deleteMessagesByIds, deleteMessagesByJid, getContactProfile, saveContactProfile } = require('../../db/queries');

router.get('/', (req, res) => {
    const chats = getAllChats();
    res.render('chats', { title: 'EPLY — Chats', chats });
});

router.get('/:jid', (req, res) => {
    const jid = decodeURIComponent(req.params.jid);
    const thread = getThread(jid, 50);
    const contactProfile = getContactProfile(jid);
    res.render('thread', { title: `Chat — ${jid.split('@')[0]}`, thread, jid, saved: req.query.saved === '1', contactProfile });
});

router.post('/:jid/delete-selected', (req, res) => {
    const jid = decodeURIComponent(req.params.jid);
    const ids = Array.isArray(req.body.message_ids)
        ? req.body.message_ids
        : req.body.message_ids ? [req.body.message_ids] : [];

    deleteMessagesByIds(ids);
    res.redirect(`/chats/${encodeURIComponent(jid)}?saved=1`);
});

router.post('/:jid/clear', (req, res) => {
    const jid = decodeURIComponent(req.params.jid);
    deleteMessagesByJid(jid);
    res.redirect('/chats');
});

router.post('/:jid/profile', (req, res) => {
    const jid = decodeURIComponent(req.params.jid);
    saveContactProfile({
        jid,
        displayName: req.body.display_name,
        tonePreference: req.body.tone_preference || 'auto',
        respectfulTitles: req.body.respectful_titles === 'on',
        wittyAllowed: req.body.witty_allowed === 'on',
        muted: req.body.muted === 'on',
    });
    res.redirect(`/chats/${encodeURIComponent(jid)}?saved=1`);
});

module.exports = router;
