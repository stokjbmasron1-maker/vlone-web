
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const WINDOW_MS =
  Number(process.env.VERIFY_RATE_WINDOW_MS) > 0
    ? Number(process.env.VERIFY_RATE_WINDOW_MS)
    : 60_000;
const MAX_PER_WINDOW =
  Number(process.env.VERIFY_RATE_MAX) > 0
    ? Number(process.env.VERIFY_RATE_MAX)
    : 30;
const rateState = new Map();

function getClientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function allowRateLimit(ip) {
  const now = Date.now();
  let slot = rateState.get(ip);
  if (!slot || now > slot.resetAt) {
    slot = { count: 1, resetAt: now + WINDOW_MS };
    rateState.set(ip, slot);
    return true;
  }
  if (slot.count >= MAX_PER_WINDOW) return false;
  slot.count += 1;
  return true;
}

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).end(JSON.stringify(body));
}

function normalizeKey(raw) {
  if (typeof raw !== 'string') return '';
  const k = raw.trim().toUpperCase();
  if (!/^VLN-[A-F0-9]{8}-[A-Z0-9]{3}$/.test(k)) return '';
  return k;
}

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function signSessionJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + 4 * 3600 };
  const h = b64urlJson(header);
  const p = b64urlJson(body);
  const data = `${h}.${p}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return json(res, 405, { valid: false, message: 'Method not allowed' });
  }

  const ip = getClientIp(req);
  if (!allowRateLimit(ip)) {
    return json(res, 429, { valid: false, message: 'Too many requests. Try again in a minute.' });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const jwtSecret = process.env.JWT_SECRET;
  if (!url || !serviceKey || !jwtSecret) {
    return json(res, 500, { valid: false, message: 'Server misconfigured' });
  }

  let body;
  try {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      body = req.body;
    } else {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    }
  } catch {
    return json(res, 400, { valid: false, message: 'Invalid JSON body' });
  }

  const key = normalizeKey(body.key);
  const hwid = typeof body.hwid === 'string' ? body.hwid.trim() : '';
  const deviceNameRaw = typeof body.device_name === 'string' ? body.device_name.trim() : '';
  const deviceName =
    deviceNameRaw.length > 0
      ? deviceNameRaw.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 128)
      : '';
  if (!key) {
    return json(res, 400, { valid: false, message: 'Invalid key format' });
  }
  if (hwid.length < 8 || hwid.length > 256) {
    return json(res, 400, { valid: false, message: 'Invalid HWID' });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: row, error: qErr } = await supabase
    .from('subscriptions')
    .select('id, plan, expires_at, is_active, license_key, hwid, device_count')
    .eq('license_key', key)
    .eq('is_active', true)
    .maybeSingle();

  if (qErr) {
    console.error('verify query', qErr);
    return json(res, 500, { valid: false, message: 'Database error' });
  }
  if (!row) {
    return json(res, 200, { valid: false, message: 'Invalid key' });
  }

  const now = new Date();
  if (row.expires_at) {
    const exp = new Date(row.expires_at);
    if (exp.getTime() < now.getTime()) {
      return json(res, 200, { valid: false, message: 'License expired' });
    }
  }

  const bound = row.hwid != null && String(row.hwid).trim() !== '';
  const storedHwid = bound ? String(row.hwid).trim() : '';
  const mismatchMsg =
    'This license is already registered to another device. Use the original PC or contact support.';

  let firstActivation = false;

  if (!bound) {
    const nextCount = (typeof row.device_count === 'number' ? row.device_count : 0) + 1;
    const bindPatch = {
      hwid: hwid,
      device_count: nextCount,
    };
    if (deviceName) bindPatch.device_name = deviceName;
    const { data: updated, error: uErr } = await supabase
      .from('subscriptions')
      .update(bindPatch)
      .eq('id', row.id)
      .is('hwid', null)
      .select('id')
      .maybeSingle();

    if (uErr) {
      console.error('verify bind', uErr);
      return json(res, 500, { valid: false, message: 'Database error' });
    }

    if (updated) {
      firstActivation = true;
    }

    if (!updated) {
      const { data: again, error: aErr } = await supabase
        .from('subscriptions')
        .select('hwid')
        .eq('id', row.id)
        .single();
      if (aErr || String(again?.hwid || '').trim() !== hwid) {
        return json(res, 200, { valid: false, message: mismatchMsg });
      }
    }
  } else if (storedHwid !== hwid) {
    return json(res, 200, { valid: false, message: mismatchMsg });
  }

  const touchPatch = { last_verified_at: now.toISOString() };
  if (deviceName) touchPatch.device_name = deviceName;
  const { error: touchErr } = await supabase
    .from('subscriptions')
    .update(touchPatch)
    .eq('id', row.id);
  if (touchErr) console.error('verify touch', touchErr);

  const session_token = signSessionJwt(
    { sub: row.id, plan: row.plan, k: key.slice(0, 16) },
    jwtSecret
  );

  return json(res, 200, {
    valid: true,
    plan: row.plan,
    expires_at: row.expires_at,
    session_token,
    first_activation: firstActivation,
    message: firstActivation
      ? 'License verified. This device is now registered for this key.'
      : 'License verified.',
  });
}
