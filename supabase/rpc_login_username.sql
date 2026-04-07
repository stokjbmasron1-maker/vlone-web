-- =====================================================
-- Login pakai username + cek username saat register
-- Jalankan sekali di Supabase → SQL Editor
--
-- Tanpa ini, anon tidak bisa baca profiles (RLS) → login username gagal.
-- =====================================================

-- Email untuk signInWithPassword (username -> email).
-- Fallback ke auth.users jika profiles sempat kosong/kehapus.
CREATE OR REPLACE FUNCTION public.get_email_by_username(u text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
DECLARE
  v_u text := lower(trim(u));
  v_email text;
BEGIN
  IF v_u IS NULL OR v_u = '' THEN
    RETURN NULL;
  END IF;

  -- 1) prioritas tabel profiles
  SELECT p.email::text
    INTO v_email
  FROM public.profiles p
  WHERE lower(p.username) = v_u
  LIMIT 1;
  IF v_email IS NOT NULL THEN
    RETURN v_email;
  END IF;

  -- 2) fallback metadata auth.users
  SELECT au.email::text
    INTO v_email
  FROM auth.users au
  WHERE lower(coalesce(au.raw_user_meta_data->>'username', '')) = v_u
  LIMIT 1;

  RETURN v_email;
END;
$$;

-- true = username masih boleh dipakai
-- Cek di profiles + auth.users metadata agar konsisten.
CREATE OR REPLACE FUNCTION public.is_username_available(u text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
DECLARE
  v_u text := lower(trim(u));
BEGIN
  IF v_u IS NULL OR v_u = '' THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE lower(p.username) = v_u
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM auth.users au
    WHERE lower(coalesce(au.raw_user_meta_data->>'username', '')) = v_u
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_email_by_username(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_username_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO anon, authenticated;
