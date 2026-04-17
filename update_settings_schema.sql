-- Add missing columns to user_settings for persisting requirements
ALTER TABLE public.user_settings 
ADD COLUMN IF NOT EXISTS duration_override TEXT DEFAULT 'original',
ADD COLUMN IF NOT EXISTS slot_alignment TEXT DEFAULT '15',
ADD COLUMN IF NOT EXISTS selected_days INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5],
ADD COLUMN IF NOT EXISTS placeholder_date TEXT;

-- Ensure RLS is still correct (it should be as we're just adding columns)