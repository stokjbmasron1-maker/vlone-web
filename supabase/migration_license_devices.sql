-- Multi-device licenses: max_devices (default 1) + per-HWID rows.
-- Run in Supabase SQL Editor after subscriptions exists.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS max_devices integer NOT NULL DEFAULT 1;

UPDATE public.subscriptions SET max_devices = 1 WHERE max_devices IS NULL;

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

INSERT INTO public.license_devices (subscription_id, hwid, device_name)
SELECT s.id, trim(s.hwid), s.device_name
FROM public.subscriptions s
WHERE s.hwid IS NOT NULL AND length(trim(s.hwid)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.license_devices d
    WHERE d.subscription_id = s.id AND d.hwid = trim(s.hwid)
  );

ALTER TABLE public.license_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own license_devices" ON public.license_devices;
CREATE POLICY "Users select own license_devices"
  ON public.license_devices FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.id = license_devices.subscription_id AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users delete own license_devices" ON public.license_devices;
CREATE POLICY "Users delete own license_devices"
  ON public.license_devices FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.id = license_devices.subscription_id AND s.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.purchase_extra_device_slot(target_sub uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  price int := 50;
  cur_vt int;
  sub_user uuid;
  cur_max int;
BEGIN
  IF uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Not authenticated');
  END IF;
  SELECT user_id, COALESCE(max_devices, 1)
  INTO sub_user, cur_max
  FROM public.subscriptions
  WHERE id = target_sub AND is_active = true;
  IF sub_user IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Subscription not found');
  END IF;
  IF sub_user <> uid THEN
    RETURN json_build_object('ok', false, 'error', 'Not your license');
  END IF;
  SELECT vtokens INTO cur_vt FROM public.profiles WHERE id = uid;
  IF cur_vt IS NULL OR cur_vt < price THEN
    RETURN json_build_object('ok', false, 'error', 'Not enough VTokens (50 required)');
  END IF;
  UPDATE public.profiles SET vtokens = vtokens - price WHERE id = uid;
  UPDATE public.subscriptions
  SET max_devices = cur_max + 1
  WHERE id = target_sub;
  RETURN json_build_object('ok', true, 'max_devices', cur_max + 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_license_device_by_id(device_row uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  sub_id uuid;
  owner uuid;
BEGIN
  IF uid IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Not authenticated');
  END IF;
  SELECT subscription_id INTO sub_id FROM public.license_devices WHERE id = device_row;
  IF sub_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Device not found');
  END IF;
  SELECT user_id INTO owner FROM public.subscriptions WHERE id = sub_id;
  IF owner IS NULL OR owner <> uid THEN
    RETURN json_build_object('ok', false, 'error', 'Forbidden');
  END IF;
  DELETE FROM public.license_devices WHERE id = device_row;
  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_extra_device_slot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_license_device_by_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purchase_extra_device_slot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_license_device_by_id(uuid) TO authenticated;
