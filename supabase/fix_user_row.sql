-- ============================================================
-- Fix: Manually create user row if the trigger missed it
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================

INSERT INTO public.users (id, email, name, plan)
SELECT
  id,
  email,
  COALESCE(raw_user_meta_data->>'name', split_part(email, '@', 1)) AS name,
  'free' AS plan
FROM auth.users
WHERE email = 'hsuwdkevin@gmail.com'
ON CONFLICT (id) DO NOTHING;

-- Verify it worked:
SELECT id, email, name, plan, created_at FROM public.users;
