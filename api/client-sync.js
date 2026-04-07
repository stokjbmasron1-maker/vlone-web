import { createClient } from '@supabase/supabase-js';

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).end(JSON.stringify(body));
}

function normalizeKey(raw) {
  if (typeof raw !== 'string') return '';
  const k = raw.trim().toUpperCase();
  return /^CODEX-[A-F0-9]{8}-[A-Z0-9]{3}$/.test(k) ? k : '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed' });

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return json(res, 500, { ok: false, error: 'Server misconfigured' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const key = normalizeKey(body.key);
  const hwid = typeof body.hwid === 'string' ? body.hwid.trim() : '';
  const device = typeof body.device_name === 'string' && body.device_name.trim() ? body.device_name.trim().slice(0, 128) : 'Unknown';
  const world = typeof body.world_name === 'string' && body.world_name.trim() ? body.world_name.trim().slice(0, 128) : 'Unknown';
  if (!key || hwid.length < 8) return json(res, 400, { ok: false, error: 'Bad payload' });

  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sub, error: subErr } = await sb
    .from('subscriptions')
    .select('id, user_id, plan, expires_at, is_active')
    .eq('license_key', key)
    .eq('is_active', true)
    .maybeSingle();
  if (subErr) return json(res, 500, { ok: false, error: 'Database error' });
  if (!sub) return json(res, 200, { ok: false, error: 'Invalid license' });

  if (sub.expires_at && new Date(sub.expires_at).getTime() < Date.now()) {
    return json(res, 200, { ok: false, error: 'License expired' });
  }

  const status = world === 'Unknown' ? 'Injected' : 'Online';
  const payload = {
    subscription_id: sub.id,
    user_id: sub.user_id,
    license_key: key,
    hwid,
    device_name: device,
    world_name: world,
    status,
    last_seen_at: new Date().toISOString(),
  };

  const up = await sb.from('client_bots').upsert(payload, { onConflict: 'subscription_id,hwid' }).select('remote_mods').maybeSingle();
  if (up.error) return json(res, 500, { ok: false, error: up.error.message });

  return json(res, 200, { ok: true, remote_mods: up.data?.remote_mods || {} });
}
