'use strict';

const express = require('express');
const router = express.Router();
const { getJobs, createJob, deleteJob } = require('../../db/queries');

router.get('/', (req, res) => {
    const jobs = getJobs();
    res.render('scheduler', { title: 'EPLY — Scheduler', jobs });
});

router.post('/create', (req, res) => {
    const { name, cron_expr } = req.body;
    if (name) createJob({ name, cronExpr: cron_expr });
    res.redirect('/scheduler');
});

router.post('/:id/delete', (req, res) => {
    deleteJob(req.params.id);
    res.redirect('/scheduler');
});

module.exports = router;
