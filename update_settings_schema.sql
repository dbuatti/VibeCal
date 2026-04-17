-- Add movable_keywords column to user_settings if it doesn't exist
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_settings' AND column_name='movable_keywords') THEN
    ALTER TABLE public.user_settings ADD COLUMN movable_keywords TEXT[] DEFAULT ARRAY['arrangement', 'email', 'outreach', 'draft', 'exploration'];
  END IF;
END $$;