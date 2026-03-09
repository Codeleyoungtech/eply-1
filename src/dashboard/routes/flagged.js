'use strict';

const express = require('express');
const router = express.Router();
const { getFlagged, markHandled } = require('../../db/queries');

router.get('/', (req, res) => {
    const showAll = req.query.all === '1';
    const items = getFlagged(!showAll ? false : undefined);
    res.render('flagged', { title: 'EPLY — Flagged', items, showAll });
});

router.post('/:id/handled', (req, res) => {
    markHandled(req.params.id);
    res.redirect('/flagged');
});

module.exports = router;
