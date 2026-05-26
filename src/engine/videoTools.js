'use strict';

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { logger } = require('../logger');
const { ensureDir } = require('../config/paths');

const DOWNLOAD_DIR = path.join(process.cwd(), 'temp', 'downloads');
ensureDir(DOWNLOAD_DIR);

/**
 * Downloads a video from a URL using yt-dlp.
 * Returns the file path and metadata.
 */
async function downloadVideo(url, options = {}) {
    return new Promise((resolve, reject) => {
        const timestamp = Date.now();
        const outputPath = path.join(DOWNLOAD_DIR, `dl_${timestamp}.%(ext)s`);
        
        // Basic flags for compatibility and speed
        // -f 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best' is common but might fail without ffmpeg
        // We'll try to get the best single file that is playable.
        let format = 'best[ext=mp4]/best';
        if (options.audioOnly) {
            format = 'bestaudio[ext=m4a]/bestaudio/best';
        }

        const cmd = `yt-dlp -f "${format}" -o "${outputPath}" --max-filesize 50M --no-playlist "${url}"`;
        
        logger.info('Starting download', { url, cmd });

        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                logger.error('Download failed', { error: error.message, stderr });
                return reject(new Error('Failed to download video. It might be too large or the link is unsupported.'));
            }

            // Find the actual file (since we used %(ext)s)
            const files = fs.readdirSync(DOWNLOAD_DIR);
            const downloadedFile = files.find(f => f.startsWith(`dl_${timestamp}`));
            
            if (!downloadedFile) {
                return reject(new Error('Download finished but file not found.'));
            }

            const filePath = path.join(DOWNLOAD_DIR, downloadedFile);
            const stats = fs.statSync(filePath);

            resolve({
                filePath,
                fileName: downloadedFile,
                size: stats.size,
                ext: path.extname(downloadedFile).slice(1)
            });
        });
    });
}

/**
 * Gets info about a video without downloading.
 */
async function getVideoInfo(url) {
    return new Promise((resolve, reject) => {
        const cmd = `yt-dlp --dump-json --no-playlist "${url}"`;
        
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error('Failed to fetch video info.'));
            }
            try {
                const info = JSON.parse(stdout);
                resolve(info);
            } catch (err) {
                reject(new Error('Failed to parse video info.'));
            }
        });
    });
}

module.exports = {
    downloadVideo,
    getVideoInfo
};
