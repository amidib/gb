// api/validate-license.js
import { Redis } from '@upstash/redis';

const kv = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    const { license_key } = req.body || {};
    if (!license_key) return res.status(400).json({ ok: false, error: 'No license key' });

    const key = license_key.trim().toUpperCase();
    const data = await kv.get(`license:${key}`);

    if (!data) return res.status(200).json({ ok: false, error: 'not_found' });
    if (data.status !== 'active') return res.status(200).json({ ok: false, error: data.status });

    await kv.set(`license:${key}`, { ...data, last_seen: new Date().toISOString() });

    return res.status(200).json({ ok: true });
}
