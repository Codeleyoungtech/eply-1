'use strict';

const express = require('express');
const router = express.Router();
const { getAllChats, getThread } = require('../../db/queries');

router.get('/', (req, res) => {
    const chats = getAllChats();
    res.render('chats', { title: 'EPLY — Chats', chats });
});

router.get('/:jid', (req, res) => {
    const jid = decodeURIComponent(req.params.jid);
    const thread = getThread(jid, 50);
    res.render('thread', { title: `Chat — ${jid.split('@')[0]}`, thread, jid });
});

module.exports = router;
