-- Ensure the calendar_events_cache table has a unique constraint for upserting
ALTER TABLE public.calendar_events_cache 
DROP CONSTRAINT IF EXISTS calendar_events_cache_user_id_event_id_key;

ALTER TABLE public.calendar_events_cache 
ADD CONSTRAINT calendar_events_cache_user_id_event_id_key UNIQUE (user_id, event_id);