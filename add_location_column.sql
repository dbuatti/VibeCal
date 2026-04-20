-- Add location column to calendar_events_cache
ALTER TABLE public.calendar_events_cache ADD COLUMN IF NOT EXISTS location TEXT;