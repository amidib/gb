// api/admin/licenses.js
// Требует заголовок: x-admin-secret = ADMIN_SECRET из env

import { kv } from '@vercel/kv';
import crypto from 'crypto';

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

    // GET /api/admin/licenses — список всех ключей
    if (req.method === 'GET') {
        const keys = await kv.smembers('licenses:all');
        if (!keys || keys.length === 0) return res.json([]);

        const pipeline = kv.pipeline();
        for (const k of keys) pipeline.hgetall(`license:${k}`);
        const results = await pipeline.exec();

        const licenses = keys.map((k, i) => ({ key: k, ...results[i] }))
            .filter(Boolean)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        return res.json(licenses);
    }

    // POST /api/admin/licenses — создать ключ
    if (req.method === 'POST') {
        const { note, custom_key } = req.body || {};
        let key;

        if (custom_key) {
            const fmt = /^GB-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/i;
            if (!fmt.test(custom_key)) return res.status(400).json({ error: 'Invalid key format' });
            key = custom_key.toUpperCase();
            const exists = await kv.hgetall(`license:${key}`);
            if (exists) return res.status(409).json({ error: 'Key already exists' });
        } else {
            // Генерация уникального ключа
            let attempts = 0;
            do {
                key = generateKey();
                const exists = await kv.hgetall(`license:${key}`);
                if (!exists) break;
                attempts++;
            } while (attempts < 10);
        }

        const data = {
            status: 'active',
            note: note || '',
            created_at: new Date().toISOString(),
            last_seen: '',
        };

        await kv.hset(`license:${key}`, data);
        await kv.sadd('licenses:all', key);

        return res.status(201).json({ key, ...data });
    }

    // PATCH /api/admin/licenses — изменить статус (revoke / restore)
    if (req.method === 'PATCH') {
        const { key, status, note } = req.body || {};
        if (!key) return res.status(400).json({ error: 'No key' });

        const exists = await kv.hgetall(`license:${key}`);
        if (!exists) return res.status(404).json({ error: 'Key not found' });

        const updates = {};
        if (status) updates.status = status; // 'active' | 'revoked' | 'suspended'
        if (note !== undefined) updates.note = note;

        await kv.hset(`license:${key}`, updates);
        return res.json({ key, ...exists, ...updates });
    }

    // DELETE /api/admin/licenses — удалить ключ полностью
    if (req.method === 'DELETE') {
        const { key } = req.body || {};
        if (!key) return res.status(400).json({ error: 'No key' });

        await kv.del(`license:${key}`);
        await kv.srem('licenses:all', key);

        return res.json({ deleted: true, key });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
