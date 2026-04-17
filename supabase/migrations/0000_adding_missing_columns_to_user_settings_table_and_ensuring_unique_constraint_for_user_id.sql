-- Add missing columns to user_settings to match the application state
ALTER TABLE public.user_settings 
ADD COLUMN IF NOT EXISTS day_start_time TEXT DEFAULT '09:00',
ADD COLUMN IF NOT EXISTS day_end_time TEXT DEFAULT '17:00',
ADD COLUMN IF NOT EXISTS max_hours_per_day INTEGER DEFAULT 6,
ADD COLUMN IF NOT EXISTS optimisation_aggressiveness TEXT DEFAULT 'balanced',
ADD COLUMN IF NOT EXISTS preview_mode_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS group_similar_tasks BOOLEAN DEFAULT true;

-- Ensure user_id has a unique constraint so that upsert operations work correctly
DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_user_id_key'
  ) THEN
    ALTER TABLE public.user_settings ADD CONSTRAINT user_settings_user_id_key UNIQUE (user_id);
  END IF;
END $$;