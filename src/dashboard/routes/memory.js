'use strict';

const express = require('express');
const router = express.Router();
const { getAllMemories, deleteFact, updateFact } = require('../../db/queries');

router.get('/', (req, res) => {
    const memories = getAllMemories();
    res.render('memory', { title: 'EPLY — Memory', memories });
});

router.post('/:id/delete', (req, res) => {
    deleteFact(req.params.id);
    res.redirect('/memory');
});

router.post('/:id/edit', (req, res) => {
    updateFact(req.params.id, req.body.fact);
    res.redirect('/memory');
});

module.exports = router;
