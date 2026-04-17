-- Run this in your Supabase SQL Editor:

-- Add Apple Calendar credential columns to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS apple_id TEXT,
ADD COLUMN IF NOT EXISTS apple_app_password TEXT;

-- Add provider column to calendar_events_cache to distinguish sources
ALTER TABLE public.calendar_events_cache 
ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'google';

-- Add provider column to user_calendars
ALTER TABLE public.user_calendars 
ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'google';