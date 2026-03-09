'use strict';

const express = require('express');
const session = require('express-session');
const path = require('path');
const { logger, logEmitter } = require('../logger');
const { getStatus } = require('../whatsapp/connection');

// Routes
const authRouter = require('./routes/auth');
const homeRouter = require('./routes/home');
const qrRouter = require('./routes/qr');
const identityRouter = require('./routes/identity');
const vipRouter = require('./routes/vip');
const flaggedRouter = require('./routes/flagged');
const digestRouter = require('./routes/digest');
const chatsRouter = require('./routes/chats');
const memoryRouter = require('./routes/memory');
const schedulerRouter = require('./routes/scheduler');
const settingsRouter = require('./routes/settings');
const logsRouter = require('./routes/logs');
const healthRouter = require('./routes/health');

function createApp() {
    const app = express();

    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(path.join(__dirname, 'public')));

    // Session
    app.use(session({
        secret: process.env.DASHBOARD_PASSWORD || 'eply-session-secret',
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
    }));

    // Make WA status available in all views
    app.use((req, res, next) => {
        res.locals.waStatus = getStatus();
        res.locals.currentPath = req.path;
        next();
    });

    // Auth (unprotected routes first)
    app.use('/', authRouter);
    app.use('/health', healthRouter);  // must be unprotected for Railway uptime check

    // Auth guard middleware
    function requireAuth(req, res, next) {
        if (req.session?.authenticated) return next();
        res.redirect('/login');
    }

    // Protected routes
    app.use('/', requireAuth, homeRouter);
    app.use('/qr', requireAuth, qrRouter);
    app.use('/identity', requireAuth, identityRouter);
    app.use('/vip', requireAuth, vipRouter);
    app.use('/flagged', requireAuth, flaggedRouter);
    app.use('/digest', requireAuth, digestRouter);
    app.use('/chats', requireAuth, chatsRouter);
    app.use('/memory', requireAuth, memoryRouter);
    app.use('/scheduler', requireAuth, schedulerRouter);
    app.use('/settings', requireAuth, settingsRouter);
    app.use('/logs', requireAuth, logsRouter);

    // 404
    app.use((req, res) => {
        res.status(404).render('error', { title: '404 — Not Found', message: `Page not found: ${req.path}` });
    });

    // Error handler
    app.use((err, req, res, next) => {
        logger.error('Express error', { err: err.message });
        res.status(500).render('error', { title: 'Server Error', message: err.message });
    });

    return app;
}

module.exports = { createApp };
