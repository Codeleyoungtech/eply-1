'use strict';

/**
 * Gemini LLM Client — vision path for images, PDFs, documents.
 * Model: gemini-2.0-flash
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { logger } = require('../logger');

let genAI;

function getGenAI() {
    if (!genAI) {
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
    return genAI;
}

/**
 * @param {string}      systemPrompt
 * @param {Array}       messages       — [{role, content}]
 * @param {Buffer|null} mediaBuffer    — raw bytes of the media file
 * @param {string|null} mediaType      — 'image' | 'audio' | 'document' | 'video'
 * @returns {string} reply text
 */
async function callGemini(systemPrompt, messages, mediaBuffer = null, mediaType = null) {
    const genAIClient = getGenAI();
    const model = genAIClient.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: systemPrompt,
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 160,
        },
    });

    // Build content parts
    const lastUserMsg = messages[messages.length - 1]?.content || '';
    const parts = [{ text: lastUserMsg }];

    if (mediaBuffer && mediaType) {
        const mimeMap = {
            image: 'image/jpeg',
            audio: 'audio/ogg',
            document: 'application/pdf',
            video: 'video/mp4',
        };
        parts.unshift({
            inlineData: {
                mimeType: mimeMap[mediaType] || 'application/octet-stream',
                data: mediaBuffer.toString('base64'),
            },
        });
    }

    // Build history (all but last message)
    const history = messages.slice(0, -1).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(parts);
    const reply = result.response.text()?.trim();

    if (!reply) throw new Error('Gemini returned empty response');
    logger.debug('Gemini reply generated');
    return reply;
}

async function transcribeGeminiAudio(audioBuffer, { mimeType = 'audio/ogg' } = {}) {
    const genAIClient = getGenAI();
    const model = genAIClient.getGenerativeModel({
        model: process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-2.0-flash',
        generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 700,
        },
    });

    const result = await model.generateContent([
        {
            inlineData: {
                mimeType,
                data: audioBuffer.toString('base64'),
            },
        },
        { text: 'Transcribe this WhatsApp voice note accurately. Return only the transcript text.' },
    ]);

    const text = result.response.text()?.trim();
    if (!text) throw new Error('Gemini returned empty transcription');
    logger.debug('Gemini audio transcribed', { chars: text.length });
    return text;
}

async function generateEmbedding(text) {
    const genAIClient = getGenAI();
    const model = genAIClient.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent(text);
    return result.embedding.values;
}

module.exports = { callGemini, transcribeGeminiAudio, generateEmbedding };
