-- Update movable_keywords column with broader defaults
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_settings' AND column_name='movable_keywords') THEN
    ALTER TABLE public.user_settings ADD COLUMN movable_keywords TEXT[] DEFAULT ARRAY['arrangement', 'email', 'outreach', 'draft', 'exploration', 'tidy', 'vacuum', '🎹', '📣', '📬', '🧹'];
  ELSE
    -- If it exists, we don't overwrite user data, but this script ensures the column is ready.
  END IF;
END $$;