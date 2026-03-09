'use strict';

const express = require('express');
const router = express.Router();

router.get('/login', (req, res) => {
    if (req.session?.authenticated) return res.redirect('/');
    res.render('login', { title: 'EPLY — Login', error: null });
});

router.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === (process.env.DASHBOARD_PASSWORD || 'eply')) {
        req.session.authenticated = true;
        res.redirect('/');
    } else {
        res.render('login', { title: 'EPLY — Login', error: 'Wrong password' });
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
