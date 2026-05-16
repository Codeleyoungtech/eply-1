'use strict';

function parseDueAt(input) {
    const text = String(input || '').toLowerCase();
    const now = new Date();
    const due = new Date(now);

    const inMatch = text.match(/\bin\s+(\d+)\s*(minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\b/);
    if (inMatch) {
        const amount = Number(inMatch[1]);
        const unit = inMatch[2];
        const ms = unit.startsWith('min') ? amount * 60_000
            : unit.startsWith('h') ? amount * 60 * 60_000
                : amount * 24 * 60 * 60_000;
        return Math.floor((Date.now() + ms) / 1000);
    }

    if (/\btomorrow\b/.test(text)) {
        due.setDate(due.getDate() + 1);
    }

    const nextWeekday = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (nextWeekday) {
        const wanted = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(nextWeekday[1]);
        const delta = (wanted - due.getDay() + 7) % 7 || 7;
        due.setDate(due.getDate() + delta);
    }

    const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
    if (timeMatch) {
        let hour = Number(timeMatch[1]);
        const minute = Number(timeMatch[2] || 0);
        const meridian = timeMatch[3];
        if (meridian === 'pm' && hour < 12) hour += 12;
        if (meridian === 'am' && hour === 12) hour = 0;
        due.setHours(hour, minute, 0, 0);
    } else if (/\btomorrow\b/.test(text) || nextWeekday) {
        due.setHours(9, 0, 0, 0);
    }

    if (due.getTime() <= now.getTime()) {
        due.setHours(due.getHours() + 1);
    }

    return Math.floor(due.getTime() / 1000);
}

function stripReminderCommand(text) {
    return String(text || '')
        .replace(/^!(remind|reminder|followup|follow-up)\s*/i, '')
        .replace(/\b(in\s+\d+\s*(minutes?|mins?|hours?|hrs?|days?)|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/ig, '')
        .trim();
}

module.exports = { parseDueAt, stripReminderCommand };
