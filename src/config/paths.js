'use strict';

const fs = require('fs');
const path = require('path');

function resolveRuntimePath(value) {
    if (!value) return value;
    return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function getDataDir() {
    return resolveRuntimePath(process.env.DATA_DIR || './data');
}

function getDbPath() {
    return resolveRuntimePath(process.env.DB_PATH || path.join(getDataDir(), 'eply.db'));
}

function getAuthDir() {
    return resolveRuntimePath(process.env.AUTH_DIR || path.join(getDataDir(), 'auth_info_baileys'));
}

function getLogDir() {
    return resolveRuntimePath(process.env.LOG_DIR || path.join(getDataDir(), 'logs'));
}

function getSessionDir() {
    return resolveRuntimePath(process.env.SESSION_DIR || path.join(getDataDir(), 'sessions'));
}

function ensureRuntimeDirs() {
    ensureDir(getDataDir());
    ensureDir(path.dirname(getDbPath()));
    ensureDir(getAuthDir());
    ensureDir(getLogDir());
    ensureDir(getSessionDir());
}

module.exports = {
    ensureDir,
    ensureRuntimeDirs,
    getAuthDir,
    getDataDir,
    getDbPath,
    getLogDir,
    getSessionDir,
    resolveRuntimePath,
};
