-- Client bot sessions + remote mod sync

CREATE TABLE IF NOT EXISTS public.client_bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  license_key text NOT NULL,
  hwid text NOT NULL,
  player_name text NOT NULL DEFAULT 'Unknown',
  device_name text NOT NULL DEFAULT 'Unknown',
  world_name text NOT NULL DEFAULT 'Unknown',
  status text NOT NULL DEFAULT 'Injected' CHECK (status IN ('Injected', 'Online')),
  remote_mods jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_mods jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subscription_id, hwid)
);

CREATE INDEX IF NOT EXISTS idx_client_bots_user_id ON public.client_bots(user_id);
CREATE INDEX IF NOT EXISTS idx_client_bots_last_seen ON public.client_bots(last_seen_at DESC);

ALTER TABLE public.client_bots ENABLE ROW LEVEL SECURITY;

-- Kolom baru untuk upgrade dari versi migration lama (CREATE TABLE IF NOT EXISTS tidak mengubah tabel yang sudah ada)
ALTER TABLE public.client_bots
  ADD COLUMN IF NOT EXISTS client_mods jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.client_bots
  ADD COLUMN IF NOT EXISTS player_name text NOT NULL DEFAULT 'Unknown';

-- Idempotent: bisa dijalankan ulang tanpa error policy sudah ada
DROP POLICY IF EXISTS "Users select own client_bots" ON public.client_bots;
CREATE POLICY "Users select own client_bots"
  ON public.client_bots FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own client_bots remote_mods" ON public.client_bots;
CREATE POLICY "Users update own client_bots remote_mods"
  ON public.client_bots FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
