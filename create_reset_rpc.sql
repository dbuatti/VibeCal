-- Create a function to reset user data atomically
CREATE OR REPLACE FUNCTION public.full_reset_user_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with elevated privileges to ensure it can delete records
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get the ID of the user making the request
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Clear calendar events cache
  DELETE FROM public.calendar_events_cache
  WHERE user_id = v_user_id;

  -- 2. Clear optimisation history (proposed plans)
  DELETE FROM public.optimisation_history
  WHERE user_id = v_user_id;

  -- 3. Clear user calendars (optional, but usually good for a "full" reset)
  -- DELETE FROM public.user_calendars WHERE user_id = v_user_id;
  
  -- Note: We keep user_settings and profiles as they contain credentials and preferences
END;
$$;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION public.full_reset_user_data() TO authenticated;