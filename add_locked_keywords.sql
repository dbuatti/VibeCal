-- Add locked_keywords column to user_settings
ALTER TABLE public.user_settings 
ADD COLUMN IF NOT EXISTS locked_keywords TEXT[] DEFAULT ARRAY['meeting', 'call', 'appointment', 'rehearsal', 'lesson'];

-- Update existing rows to have the default if they are null
UPDATE public.user_settings 
SET locked_keywords = ARRAY['meeting', 'call', 'appointment', 'rehearsal', 'lesson']
WHERE locked_keywords IS NULL;