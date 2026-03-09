'use strict';

const express = require('express');
const router = express.Router();
const { getQrDataUrl, getStatus } = require('../../whatsapp/connection');

router.get('/', (req, res) => {
    res.render('qr', { title: 'EPLY — Connect WhatsApp', waStatus: getStatus() });
});

// Endpoint polled by the QR page every 20s
router.get('/data', (req, res) => {
    res.json({ qr: getQrDataUrl(), status: getStatus() });
});

module.exports = router;
