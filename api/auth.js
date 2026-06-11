import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

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

  try {
    const key = 'session:' + password.trim().toLowerCase();
    const session = await redis.get(key);

    if (!session) {
      return res.status(401).json({ success: false, error: 'Invalid access code. Please check your code or contact brandon@4thdmc.com.' });
    }

    const remaining = session.limit - session.used;

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
