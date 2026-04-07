-- =====================================================
-- Fix: "Database error saving new user" on Supabase signup
-- Run in Supabase → SQL Editor (once)
--
-- Penyebab umum:
-- 1) Kolom profiles.vtokens NOT NULL tanpa DEFAULT → INSERT trigger gagal
-- 2) Username bentrok UNIQUE (email local-part sama dengan username user lain)
-- =====================================================

-- Kolom yang dipakai app tapi sering belum di trigger lama:
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vtokens integer NOT NULL DEFAULT 0;


-- Trigger: buat profil aman (username unik, vtokens = 0)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username text;
  v_suffix   text;
BEGIN
  v_suffix := substring(replace(NEW.id::text, '-', ''), 1, 8);

  v_username := nullif(trim(NEW.raw_user_meta_data->>'username'), '');
  IF v_username IS NULL THEN
    v_username := split_part(NEW.email, '@', 1);
  END IF;
  IF v_username IS NULL OR v_username = '' THEN
    v_username := 'user';
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, username, email, vtokens)
    VALUES (
      NEW.id,
      left(v_username, 100),
      NEW.email,
      0
    );
  EXCEPTION
    WHEN unique_violation THEN
      INSERT INTO public.profiles (id, username, email, vtokens)
      VALUES (
        NEW.id,
        left(v_username, 50) || '_' || v_suffix,
        NEW.email,
        0
      );
  END;

  RETURN NEW;
END;
$$;

-- Pastikan trigger terpasang (nama bisa sudah ada)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
