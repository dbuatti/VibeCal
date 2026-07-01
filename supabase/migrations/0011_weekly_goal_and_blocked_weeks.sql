-- Add weekly goal hours to user_settings
ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS weekly_goal_hours INTEGER DEFAULT 30;

-- Create per-week calendar block status table
CREATE TABLE IF NOT EXISTS public.week_calendar_status (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  week_start_date DATE NOT NULL,
  is_blocked BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, week_start_date)
);

-- Enable RLS
ALTER TABLE public.week_calendar_status ENABLE ROW LEVEL SECURITY;

-- Policy: users can only see their own week calendar statuses
CREATE POLICY "Users can manage their own week calendar status"
  ON public.week_calendar_status
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Grant access
GRANT ALL ON public.week_calendar_status TO authenticated;
GRANT ALL ON public.week_calendar_status TO service_role;
