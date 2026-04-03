-- Run once in Supabase SQL Editor (after backups if needed)

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS license_key text,
  ADD COLUMN IF NOT EXISTS hwid text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS device_count int DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_subscriptions_license_key
  ON public.subscriptions(license_key);

UPDATE public.subscriptions
SET license_key = 'VLN-'
  || UPPER(SUBSTRING(REPLACE(id::text, '-', ''), 1, 8))
  || '-'
  || UPPER(LEFT(plan, 3))
WHERE license_key IS NULL;
