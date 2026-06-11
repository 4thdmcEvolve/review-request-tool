import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ipRequests = new Map();
const RATE_LIMIT = 30;
const WINDOW_MS = 60 * 60 * 1000;

function getIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function checkRateLimit(ip) {
  const now = Date.now();
  const record = ipRequests.get(ip);
  if (!record || now - record.windowStart > WINDOW_MS) {
    ipRequests.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (record.count >= RATE_LIMIT) return false;
  record.count++;
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getIP(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ success: false, error: 'Too many requests. Please slow down and try again shortly.' });
  }

  const { password, bizName, customerName, service, platform, reviewUrl, jobDetail } = req.body;

  if (!password || !bizName || !customerName || !service || !platform) {
    return res.status(400).json({ success: false, error: 'Missing required fields.' });
  }

  try {
    const key = 'session:' + password.trim().toLowerCase();
    const session = await redis.get(key);

    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid access code.' });
    }

    if (session.used >= session.limit) {
      return res.status(403).json({
        success: false,
        error: 'Session limit reached. Contact brandon@4thdmc.com for a new access code.',
        locked: true
      });
    }

    const urlLine = reviewUrl ? `\n\nReview link: ${reviewUrl}` : '';
    const detailLine = jobDetail ? `\n\nSpecific job detail: ${jobDetail}` : '';

    const prompt = `You are writing personalized review request messages on behalf of a small business owner. Generate two versions — one for text message and one for email. Both must feel genuinely personal, warm, and human. Never sound like a template or automated message.

Business name: ${bizName}
Customer first name: ${customerName}
Service performed: ${service}
Review platform: ${platform}${detailLine}${urlLine}

RULES:
- Text version: 2-4 sentences maximum. Casual, conversational, sounds like a real person texting. Include the review URL if provided.
- Email version: 3-6 sentences. Slightly warmer and more complete. Still personal not corporate. Include the review URL if provided.
- Never use phrases like "We hope you enjoyed" or "Your feedback is important to us" — these sound automated.
- Reference the specific service and the customer by name.
- If a job detail was provided weave it in naturally.
- If no review URL is provided use this placeholder: [YOUR REVIEW LINK]
- Do not include subject lines, greetings like "Dear", or sign-offs — just the message body.

Return ONLY valid JSON, no markdown, no extra text:
{"textVersion":"the text message here","emailVersion":"the email version here"}`;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const anthropicData = await anthropicRes.json();
    const raw = (anthropicData.content || [])
      .map(b => b.text || '')
      .join('')
      .replace(/```json|```/g, '')
      .trim();

    const output = JSON.parse(raw);

    // Increment counter in Redis
    await redis.set(key, {
      ...session,
      used: session.used + 1
    });

    const remaining = session.limit - session.used - 1;

    return res.status(200).json({
      success: true,
      textVersion: output.textVersion,
      emailVersion: output.emailVersion,
      remaining,
      used: session.used + 1,
      limit: session.limit
    });

  } catch (err) {
    console.error('Generate error:', err);
    return res.status(500).json({ success: false, error: 'Failed to generate. Please try again.' });
  }
}
