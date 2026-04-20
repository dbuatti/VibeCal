-- Add last_seen_at column to calendar_events_cache
ALTER TABLE public.calendar_events_cache 
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Update existing rows to have a value
UPDATE public.calendar_events_cache SET last_seen_at = NOW() WHERE last_seen_at IS NULL;