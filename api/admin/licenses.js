// api/admin/licenses.js
import { Redis } from '@upstash/redis';
import crypto from 'crypto';

const kv = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

function checkAuth(req, res) {
    const secret = req.headers['x-admin-secret'];
    if (!secret || secret !== process.env.ADMIN_SECRET) {
        res.status(401).json({ error: 'Unauthorized' });
        return false;
    }
    return true;
}

function generateKey() {
    const hex = () => crypto.randomBytes(2).toString('hex').toUpperCase();
    return `GB-${hex()}-${hex()}-${hex()}`;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (!checkAuth(req, res)) return;

    // GET — список всех ключей
    if (req.method === 'GET') {
        const keys = await kv.smembers('licenses:all');
        const gbKeys = (keys || []).filter(k => k.startsWith('GB-'));
        if (!gbKeys.length) return res.json([]);

        const licenses = await Promise.all(gbKeys.map(async (k) => {
            const data = await kv.get(`license:${k}`);
            return data ? { key: k, ...data } : null;
        }));

        return res.json(
            licenses.filter(Boolean).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        );
    }

    // POST — создать ключ
    if (req.method === 'POST') {
        const { note, custom_key } = req.body || {};
        let key;

        if (custom_key) {
            const fmt = /^GB-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/i;
            if (!fmt.test(custom_key)) return res.status(400).json({ error: 'Invalid key format' });
            key = custom_key.toUpperCase();
            const exists = await kv.get(`license:${key}`);
            if (exists) return res.status(409).json({ error: 'Key already exists' });
        } else {
            let attempts = 0;
            do {
                key = generateKey();
                const exists = await kv.get(`license:${key}`);
                if (!exists) break;
                attempts++;
            } while (attempts < 10);
        }

        const record = {
            status: 'active',
            active: true,
            note: note || '',
            created_at: new Date().toISOString(),
            last_seen: '',
        };

        await kv.set(`license:${key}`, record);
        await kv.sadd('licenses:all', key);

        return res.status(201).json({ key, ...record });
    }

    // PATCH — изменить статус
    if (req.method === 'PATCH') {
        const { key, status, note } = req.body || {};
        if (!key) return res.status(400).json({ error: 'No key' });

        const exists = await kv.get(`license:${key}`);
        if (!exists) return res.status(404).json({ error: 'Key not found' });

        const updates = { ...exists };
        if (status) {
            updates.status = status;
            updates.active = status === 'active';
        }
        if (note !== undefined) updates.note = note;

        await kv.set(`license:${key}`, updates);
        return res.json({ key, ...updates });
    }

    // DELETE — удалить ключ
    if (req.method === 'DELETE') {
        const { key } = req.body || {};
        if (!key) return res.status(400).json({ error: 'No key' });

        await kv.del(`license:${key}`);
        await kv.srem('licenses:all', key);

        return res.json({ deleted: true, key });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
