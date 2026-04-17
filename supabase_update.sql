-- Add vibe_score and vibe_score_trend to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS vibe_score INTEGER DEFAULT 70,
ADD COLUMN IF NOT EXISTS vibe_score_trend NUMERIC DEFAULT 0;

-- Update the handle_new_user function to include these defaults (optional but good practice)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    first_name,
    last_name,
    last_active_at,
    xp,
    level,
    daily_streak,
    energy,
    tasks_completed_today,
    vibe_score,
    vibe_score_trend,
    default_auto_schedule_start_time,
    default_auto_schedule_end_time,
    enable_aethersink_backup,
    journey_start_date,
    day_rollover_hour
  )
  VALUES (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    NOW(),
    0, 1, 0, 100, 0, 70, 0,
    '09:00', '17:00', TRUE, NOW()::date, 0
  );
  RETURN new;
END;
$$;