-- Create a function to atomically reset user data
CREATE OR REPLACE FUNCTION public.full_reset_user_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with elevated privileges to bypass RLS for the delete operation
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get the ID of the user calling the function
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Delete calendar cache
  DELETE FROM public.calendar_events_cache WHERE user_id = v_user_id;
  
  -- Delete optimization history
  DELETE FROM public.optimisation_history WHERE user_id = v_user_id;
  
  -- Note: We don't delete settings as the user might want to keep their preferences
END;
$$;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION public.full_reset_user_data() TO authenticated;