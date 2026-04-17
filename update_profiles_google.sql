-- Add google_access_token to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS google_access_token TEXT;

-- Ensure the column is accessible via RLS
-- (Existing policies on profiles already cover this as they allow users to see/update their own rows)