-- Fix: marketplace column too short (VARCHAR 10 → 50)
-- Run this in: Supabase Dashboard → SQL Editor

ALTER TABLE public.amazon_profiles
  ALTER COLUMN marketplace TYPE VARCHAR(50);

-- Verify:
SELECT column_name, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'amazon_profiles' AND column_name = 'marketplace';
