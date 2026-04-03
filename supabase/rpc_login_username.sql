-- =====================================================
-- Login pakai username + cek username saat register
-- Jalankan sekali di Supabase → SQL Editor
--
-- Tanpa ini, anon tidak bisa baca profiles (RLS) → login username gagal.
-- =====================================================

-- Email untuk signInWithPassword (hanya jika username ketemu)
CREATE OR REPLACE FUNCTION public.get_email_by_username(u text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.email::text
  FROM public.profiles p
  WHERE lower(p.username) = lower(trim(u))
  LIMIT 1;
$$;

-- true = username masih boleh dipakai
CREATE OR REPLACE FUNCTION public.is_username_available(u text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE lower(p.username) = lower(trim(u))
  );
$$;

REVOKE ALL ON FUNCTION public.get_email_by_username(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_username_available(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_by_username(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO anon, authenticated;
