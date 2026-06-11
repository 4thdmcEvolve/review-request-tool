import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, error: 'No access code provided.' });
  }

  console.log('ENV CHECK - KV_REST_API_URL:', !!process.env.KV_REST_API_URL);
  console.log('ENV CHECK - KV_REST_API_TOKEN:', !!process.env.KV_REST_API_TOKEN);
  console.log('ENV CHECK - UPSTASH_REDIS_REST_URL:', !!process.env.UPSTASH_REDIS_REST_URL);
  console.log('ENV CHECK - UPSTASH_REDIS_REST_TOKEN:', !!process.env.UPSTASH_REDIS_REST_TOKEN);

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    console.error('Missing Redis credentials');
    return res.status(500).json({ success: false, error: 'Server configuration error. Contact brandon@4thdmc.com.' });
  }

  const redis = new Redis({ url: redisUrl, token: redisToken });

  try {
    const key = 'session:' + password.trim().toLowerCase();
    console.log('Looking up key:', key);

    const raw = await redis.get(key);
    console.log('Raw value from Redis:', JSON.stringify(raw), typeof raw);

    if (raw === null || raw === undefined) {
      return res.status(401).json({ success: false, error: 'Invalid access code. Please check your code or contact brandon@4thdmc.com.' });
    }

    let session;
    if (typeof raw === 'string') {
      try { session = JSON.parse(raw); } catch(e) { session = null; }
    } else {
      session = raw;
    }

    if (!session || typeof session.limit === 'undefined') {
      console.error('Could not parse session:', raw);
      return res.status(500).json({ success: false, error: 'Session data error. Contact brandon@4thdmc.com.' });
    }

    const remaining = session.limit - session.used;
    console.log('Session valid. Limit:', session.limit, 'Used:', session.used, 'Remaining:', remaining);

    return res.status(200).json({
      success: true,
      remaining,
      limit: session.limit,
      used: session.used
    });

  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ success: false, error: 'Server error. Please try again.' });
  }
}
