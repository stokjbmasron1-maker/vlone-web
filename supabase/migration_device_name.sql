ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS device_name text;

COMMENT ON COLUMN public.subscriptions.device_name IS 'Friendly PC name from client verify (e.g. Windows computer name).';
