-- 1. Define the helper function first
CREATE OR REPLACE FUNCTION public.array_distinct(anyarray)
RETURNS anyarray AS $$
  SELECT ARRAY(SELECT DISTINCT unnest($1))
$$ LANGUAGE sql IMMUTABLE;

-- 2. Update locked keywords with the new show and event rules
UPDATE public.user_settings
SET locked_keywords = public.array_distinct(array_cat(COALESCE(locked_keywords, ARRAY[]::text[]), ARRAY[
  'show', 'tech', 'dress', 'night', 'opening', 'closing', 'birthday', 
  'party', 'gala', 'buffer', 'probe', 'experiment', 'quinceanera', '🎭', '✨'
]::text[]));

-- 3. Update work detection keywords
UPDATE public.user_settings
SET work_keywords = public.array_distinct(array_cat(COALESCE(work_keywords, ARRAY[]::text[]), ARRAY[
  'meeting', 'call', 'lesson', 'audition', 'rehearsal', 'appt', 
  'appointment', 'coaching', 'session', 'assessment', 'program', 'ceremony'
]::text[]));