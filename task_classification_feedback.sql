-- Create table for task classification feedback
CREATE TABLE IF NOT EXISTS public.task_classification_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  task_name TEXT NOT NULL,
  is_movable BOOLEAN NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.task_classification_feedback ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can manage their own classification feedback" ON public.task_classification_feedback
FOR ALL TO authenticated USING (auth.uid() = user_id);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_task_feedback_user_name ON public.task_classification_feedback(user_id, task_name);