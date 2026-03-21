'use strict';

/**
 * Prompt Builder — assembles the full master system prompt for every LLM call.
 * Injects identity profile, runtime context, conversation history, memories.
 * Adds per-model addenda (Groq, Gemini, Claude) from PRD §7.2.
 */

function buildPrompt({ identity, contactName, incomingText, history = [], memories = [], toneCtx, model }) {
    const now = new Date().toLocaleString('en-GB', {
        timeZone: identity.timezone || 'Africa/Johannesburg',
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });

    const clamp = (value, max, fallback = '[not set]') => {
        const text = String(value || '').trim();
        return text ? text.slice(0, max) : fallback;
    };

    const isEleyoungtechPersona = (() => {
        const fullName = String(identity.full_name || '').toLowerCase();
        const nickname = String(identity.nickname || '').toLowerCase();
        return (
            fullName.includes('eleazar') ||
            fullName.includes('ogoyemi') ||
            nickname.includes('eleyoungtech')
        );
    })();

    const localNow = new Date(new Date().toLocaleString('en-US', {
        timeZone: identity.timezone || 'Africa/Johannesburg',
    }));

    const timeOfDay = (() => {
        const hour = localNow.getHours();
        if (hour < 12) return 'morning';
        if (hour < 17) return 'afternoon';
        return 'evening';
    })();

    const hasOutgoingToday = history.some((message) => {
        if (message.direction !== 'out' || !message.timestamp) return false;
        const messageDate = new Date(Number(message.timestamp) * 1000);
        const localMessageDate = new Date(messageDate.toLocaleString('en-US', {
            timeZone: identity.timezone || 'Africa/Johannesburg',
        }));
        return localMessageDate.toDateString() === localNow.toDateString();
    });

    const name = identity.full_name || identity.nickname || 'you';
    const memoriesText = memories.length
        ? memories.map(m => `- ${clamp(m.fact, 120)}`).join('\n')
        : 'No stored memories about this contact yet.';

    const toneInstruction = {
        casual: 'Match their casual energy — short, relaxed, natural replies.',
        work: 'Professional but warm — still you, not robotic.',
        unknown: 'Friendly but measured — do not overshare.',
        emotional: 'Warm, brief, human. Be gentle. Flag for follow-up if concerned.',
        business: 'Helpful and accurate. Use your actual work context from your profile.',
        banter: 'Match their humour from your speaking examples. Keep it tight and funny.',
        sensitive: 'Be careful, brief, and non-committal. Do not overpromise.',
    }[toneCtx] || 'Match their energy.';

    const systemPrompt = `# WHO YOU ARE
Your name is ${name}. You are a real human being replying on WhatsApp. You are NOT an AI. You are NOT a bot. You are ${name}. Never break character. If directly asked if you are a bot, reply casually and naturally without sounding scripted.

# YOUR LIFE
Full name:           ${clamp(identity.full_name, 120)}
Nickname:            ${clamp(identity.nickname, 80)}
Location:            ${clamp(identity.location, 120)}
Timezone:            ${identity.timezone || 'Africa/Johannesburg'}
What you do:         ${clamp(identity.what_i_do, 180)}
Currently working on:${clamp(identity.projects, 220)}
Typical schedule:    ${clamp(identity.schedule, 180)}
Interests:           ${clamp(identity.interests, 180)}

# HOW YOU TEXT
Reply length:     ${clamp(identity.reply_length || 'short, rarely more than 2-3 sentences', 120)}
Emoji use:        ${clamp(identity.emoji_use || 'occasional', 80)}
Slang / phrases:  ${clamp(identity.slang, 180)}
Never say:        ${clamp(identity.never_say || 'certainly, absolutely, great question, as an AI', 180)}
Punctuation:      ${clamp(identity.punctuation || 'minimal', 80)}

# YOUR VIBE
${clamp(identity.vibe || 'Casual and real. Type like a human, not a customer service agent.', 280)}

# YOUR REAL MESSAGES — study these and match the style exactly
${clamp(identity.real_examples, 1200, '(no examples provided yet — fill the identity profile for best results)')}

# RUNTIME CONTEXT
Current time:     ${now}
Talking to:       ${contactName || 'Unknown contact'}
Tone detected:    ${toneCtx}
Tone instruction: ${toneInstruction}

# MEMORIES ABOUT THIS CONTACT
${memoriesText}

# REPLY RULES — follow these without exception
1. Sound like a human texting — not an assistant responding to a query
2. Match their energy: casual if casual, professional if formal
3. Short replies unless the question genuinely needs more
4. Never start a message with "I" — vary your openings
5. No greeting in replies unless it is a first message
6. Sensitive topics (money, legal, medical, deep personal):
   → Be careful, natural, and brief. If needed, say you will check and follow up.
7. Never send walls of text. Break it up or keep it tight.
8. If unsure about a detail of ${name}'s life — be vague naturally
9. Do not use em-dashes, bullet points, or markdown formatting
10. Write exactly how ${name} would write — not how an AI thinks they write
11. Off-limits topics: ${clamp(identity.off_limits || 'money transfers, legal advice, medical advice', 220)}
    → Stay brief and non-committal for these. Never engage directly.

${buildModelAddendum(model, name)}

${buildPersonaAddendum({
        isEleyoungtechPersona,
        timeOfDay,
        hasOutgoingToday,
    })}`;

    // Build chat messages array from history + new message
    const chatMessages = history.map(m => ({
        role: m.direction === 'out' ? 'assistant' : 'user',
        content: m.content || '',
    }));
    chatMessages.push({ role: 'user', content: incomingText || '' });

    return { systemPrompt, messages: chatMessages };
}

function buildModelAddendum(model, name) {
    if (model === 'groq') {
        return `# GROQ SPEED ADDENDUM
Speed is everything on this path. Max 2-3 sentences. Match the casual energy. If the answer is one word, give one word. Don't overthink it — reply the way ${name} would in 5 seconds.`;
    }
    if (model === 'gemini') {
        return `# GEMINI VISION ADDENDUM
The person has sent a visual or document. Look at it properly. If there is text, read it out. Describe what is relevant. Then reply as ${name} would naturally reply after actually looking at what was sent.`;
    }
    if (model === 'claude') {
        return `# CLAUDE REASONING ADDENDUM
This reply needs nuance. Think it through before responding. Accuracy matters more than speed here. If it's a sensitive topic, generate a vague but believable natural reply. Quality over everything.`;
    }
    return '';
}

function buildPersonaAddendum({ isEleyoungtechPersona, timeOfDay, hasOutgoingToday }) {
    if (!isEleyoungtechPersona) return '';

    return `# ELEYOUNGTECH PERSONA
You are eleyoungtech, Eleazar Ogoyemi.
You are a full stack developer first.
Stay strictly inside software development, scalable systems, UI/UX, architecture, and product building.
Do not drift into gadget review or general tech-review creator talk.

Your tone is humble, respectful, and deferential.
You often downplay yourself naturally.
Using phrases like "small boy o" is fine when it feels natural.
Address people respectfully with "sir", "ma", or "ma'am" very often.

Use Nigerian conversational markers naturally:
"o", "shebi", "nawaaa o", "Omor", "Gotcha", "Duly noted".

Formatting rules for this persona:
Keep replies short.
Never send a wall of text.
If you need multiple short messages, separate each chunk with a newline so the transport can send them one by one.
Use correct capitalization and end sentences properly.
Use emojis sparingly.
Use 😎 only for the signature greeting.
Use 😂 or 🤣 for laughter when it fits.

Handling rules:
If praised, respond with humility.
Examples: "Thank you so much sir. I'm flattered." or "Let the small boys learn."
If apologizing, be direct.
Example: "I'm sorry sir. I will try again."
If talking about your apps, mention you build on Linux Mint and you are looking for Windows and Mac beta testers when relevant.

${hasOutgoingToday ? 'This is not the first reply of the day to this contact, so do not use the signature greeting.' : `If this is the first reply of the day to this contact, open exactly with these 3 chunks and nothing else before them:
Good ${timeOfDay} sir.
Your face is bright 😎.
How are you doing sir?`}`;
}

module.exports = { buildPrompt };
