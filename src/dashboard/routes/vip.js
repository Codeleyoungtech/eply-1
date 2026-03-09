'use strict';

const express = require('express');
const router = express.Router();
const { getVips, addVip, removeVip, getDb } = require('../../db/queries');
const { getDb: rawDb } = require('../../db/schema');

router.get('/', (req, res) => {
    const vips = getVips();
    // Recent messages from VIP contacts
    const db = rawDb();
    const phones = vips.map(v => v.phone);
    let recentVipMsgs = [];
    if (phones.length) {
        recentVipMsgs = db.prepare(`
      SELECT * FROM messages WHERE direction='in'
      AND (${phones.map(() => "jid LIKE ?").join(' OR ')})
      ORDER BY timestamp DESC LIMIT 20
    `).all(...phones.map(p => `%${p}%`));
    }
    res.render('vip', { title: 'EPLY — VIP List', vips, recentVipMsgs, saved: req.query.saved });
});

router.post('/add', (req, res) => {
    const { phone, label } = req.body;
    if (phone) addVip(phone, label);
    res.redirect('/vip?saved=added');
});

router.post('/remove/:id', (req, res) => {
    removeVip(req.params.id);
    res.redirect('/vip?saved=removed');
});

module.exports = router;
