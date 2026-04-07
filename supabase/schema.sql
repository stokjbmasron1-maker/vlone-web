-- =====================================================
-- CodeX CHEATS — Supabase Database Schema
-- Run this in Supabase → SQL Editor
-- =====================================================

-- 1. PROFILES TABLE
-- Extends Supabase auth.users with extra info
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username    TEXT UNIQUE NOT NULL,
  pw_username TEXT,
  email       TEXT UNIQUE NOT NULL,
  is_new      BOOLEAN DEFAULT TRUE,
  vtokens     INTEGER NOT NULL DEFAULT 0,
  avatar_url  TEXT,
  discord     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. SUBSCRIPTIONS TABLE
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  plan        TEXT NOT NULL CHECK (plan IN ('trial','daily','monthly','lifetime')),
  tokens_paid INTEGER DEFAULT 0,
  bgl_paid    NUMERIC(10,4) DEFAULT 0,
  payment_method TEXT CHECK (payment_method IN ('bgl','crypto','card','free')),
  payment_ref TEXT,
  started_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  license_key text,
  hwid text,
  last_verified_at timestamptz,
  device_count int DEFAULT 0,
  device_name text,
  max_devices int NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_license_key ON public.subscriptions(license_key);

UPDATE public.subscriptions
SET license_key = 'VLN-'
  || UPPER(SUBSTRING(REPLACE(id::text, '-', ''), 1, 8))
  || '-'
  || UPPER(LEFT(plan, 3))
WHERE license_key IS NULL;

CREATE TABLE IF NOT EXISTS public.license_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  hwid text NOT NULL,
  device_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT license_devices_sub_hwid_unique UNIQUE (subscription_id, hwid)
);

CREATE INDEX IF NOT EXISTS idx_license_devices_subscription_id
  ON public.license_devices(subscription_id);

-- 3. KEYS TABLE (license keys generated per subscription)
CREATE TABLE IF NOT EXISTS public.keys (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  key_value       TEXT UNIQUE NOT NULL,
  is_used         BOOLEAN DEFAULT FALSE,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 4. PAYMENT REQUESTS TABLE
-- Tracks pending BGL / crypto payments for admin to verify
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan         TEXT NOT NULL,
  tokens       INTEGER NOT NULL,
  method       TEXT NOT NULL CHECK (method IN ('bgl','crypto','card')),
  reference    TEXT,                         -- Discord / TX hash
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at  TIMESTAMPTZ
);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keys            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_devices ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update their own
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Subscriptions: users can view their own
CREATE POLICY "Users can view own subscriptions"
  ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscriptions"
  ON public.subscriptions FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscriptions"
  ON public.subscriptions FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users select own license_devices"
  ON public.license_devices FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.id = license_devices.subscription_id AND s.user_id = auth.uid()
    )
  );

CREATE POLICY "Users delete own license_devices"
  ON public.license_devices FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.id = license_devices.subscription_id AND s.user_id = auth.uid()
    )
  );

-- Keys: users can view their own keys
CREATE POLICY "Users can view own keys"
  ON public.keys FOR SELECT USING (auth.uid() = user_id);

-- Payment requests: users can insert + view their own
CREATE POLICY "Users can create payment requests"
  ON public.payment_requests FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own payment requests"
  ON public.payment_requests FOR SELECT USING (auth.uid() = user_id);

-- =====================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- =====================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email,'@',1)),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- AUTO-EXPIRE SUBSCRIPTIONS (scheduled via pg_cron or edge function)
-- =====================================================

CREATE OR REPLACE FUNCTION public.expire_subscriptions()
RETURNS void AS $$
BEGIN
  UPDATE public.subscriptions
  SET is_active = FALSE
  WHERE is_active = TRUE
    AND expires_at IS NOT NULL
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- HELPER VIEWS
-- =====================================================

-- Active users with their current plan
CREATE OR REPLACE VIEW public.active_users AS
SELECT
  p.id,
  p.username,
  p.email,
  p.pw_username,
  s.plan,
  s.expires_at,
  s.tokens_paid,
  s.payment_method
FROM public.profiles p
JOIN public.subscriptions s ON s.user_id = p.id
WHERE s.is_active = TRUE
  AND (s.expires_at IS NULL OR s.expires_at > NOW());
