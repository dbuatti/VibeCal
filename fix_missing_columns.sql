-- Add missing columns to calendar_events_cache
ALTER TABLE public.calendar_events_cache ADD COLUMN IF NOT EXISTS is_work BOOLEAN DEFAULT false;
ALTER TABLE public.calendar_events_cache ADD COLUMN IF NOT EXISTS is_break BOOLEAN DEFAULT false;

-- Ensure RLS is still correct
ALTER TABLE public.calendar_events_cache ENABLE ROW LEVEL SECURITY;