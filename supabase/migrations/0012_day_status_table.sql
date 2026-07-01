-- Create per-day block/reserve status table
CREATE TABLE IF NOT EXISTS public.day_status (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  is_blocked BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, date)
);

ALTER TABLE public.day_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own day status" ON public.day_status;
CREATE POLICY "Users can manage their own day status"
  ON public.day_status
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT ALL ON public.day_status TO authenticated;
GRANT ALL ON public.day_status TO service_role;
