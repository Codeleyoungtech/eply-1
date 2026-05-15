'use strict';

const { recordLlmUsage } = require('../db/queries');
const { transcribeGroqAudio } = require('../llm/groq');
const { transcribeGeminiAudio } = require('../llm/gemini');
const { logger } = require('../logger');

function estimateTokens(text = '') {
    return Math.ceil(String(text || '').length / 4);
}

function getAudioMimeType(msg) {
    return msg?.message?.audioMessage?.mimetype ||
        msg?.message?.ephemeralMessage?.message?.audioMessage?.mimetype ||
        'audio/ogg';
}

function getAudioFilename(mimeType = 'audio/ogg') {
    if (mimeType.includes('mpeg')) return 'voice-note.mp3';
    if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'voice-note.m4a';
    if (mimeType.includes('webm')) return 'voice-note.webm';
    if (mimeType.includes('wav')) return 'voice-note.wav';
    return 'voice-note.ogg';
}

function cleanTranscript(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, Number(process.env.MAX_VOICE_TRANSCRIPT_CHARS || 3000));
}

async function transcribeVoiceNote({ jid, audioBuffer, mimeType = 'audio/ogg' }) {
    const providers = [
        process.env.GROQ_API_KEY ? 'groq' : null,
        process.env.GEMINI_API_KEY ? 'gemini' : null,
    ].filter(Boolean);

    if (!providers.length) {
        throw new Error('No Groq or Gemini key configured for voice transcription');
    }

    for (const provider of providers) {
        try {
            const transcript = provider === 'groq'
                ? await transcribeGroqAudio(audioBuffer, { filename: getAudioFilename(mimeType) })
                : await transcribeGeminiAudio(audioBuffer, { mimeType });
            const clean = cleanTranscript(transcript);

            recordLlmUsage({
                jid,
                provider,
                model: provider === 'groq'
                    ? (process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3')
                    : (process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-2.0-flash'),
                estimatedInput: estimateTokens(`[audio ${audioBuffer.length} bytes]`),
                estimatedOutput: estimateTokens(clean),
                estimatedTotal: estimateTokens(clean) + 50,
            });

            return { transcript: clean, provider };
        } catch (err) {
            logger.warn('Voice transcription provider failed', { provider, err: err.message });
        }
    }

    throw new Error('All voice transcription providers failed');
}

module.exports = { getAudioMimeType, transcribeVoiceNote };
