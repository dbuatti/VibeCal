-- Ensure user_calendars has a unique constraint for upserting
ALTER TABLE public.user_calendars 
ADD CONSTRAINT user_calendars_user_id_calendar_id_key UNIQUE (user_id, calendar_id);

-- Ensure calendar_events_cache has a unique constraint for upserting
ALTER TABLE public.calendar_events_cache 
ADD CONSTRAINT calendar_events_cache_user_id_event_id_key UNIQUE (user_id, event_id);

-- Add a column to track when an event was last seen during a sync
-- This helps us identify and remove events that were deleted in the provider
ALTER TABLE public.calendar_events_cache 
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE;