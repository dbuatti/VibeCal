-- 1. Ensure the missing columns exist in the cache table
ALTER TABLE public.calendar_events_cache ADD COLUMN IF NOT EXISTS is_work BOOLEAN DEFAULT false;
ALTER TABLE public.calendar_events_cache ADD COLUMN IF NOT EXISTS is_break BOOLEAN DEFAULT false;

-- 2. Update your locked keywords to include the new show and event rules
-- Note: This updates the settings for ALL users. If you want to target just yourself, 
-- you can add: WHERE user_id = 'your-user-id'
UPDATE public.user_settings
SET locked_keywords = ARRAY_DISTINCT(array_cat(locked_keywords, ARRAY[
  'show', 'tech', 'dress', 'night', 'opening', 'closing', 'birthday', 
  'party', 'gala', 'buffer', 'probe', 'experiment', 'quinceanera', '🎭', '✨'
]));

-- 3. Update your work detection keywords
UPDATE public.user_settings
SET work_keywords = ARRAY_DISTINCT(array_cat(work_keywords, ARRAY[
  'meeting', 'call', 'lesson', 'audition', 'rehearsal', 'appt', 
  'appointment', 'coaching', 'session', 'assessment', 'program', 'ceremony'
]));

-- Helper function to ensure unique array elements (if not already present in your DB)
CREATE OR REPLACE FUNCTION ARRAY_DISTINCT(anyarray)
RETURNS anyarray AS $$
  SELECT ARRAY(SELECT DISTINCT unnest($1))
$$ LANGUAGE sql IMMUTABLE;