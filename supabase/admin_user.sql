-- ============================================================
-- Admin User Setup for Amazon PPC Analytics
-- Run in Supabase SQL Editor
-- ============================================================

-- ── OPTION A: Elevate an existing user to agency/admin plan ──
-- Use this if you have already signed up via the login page.
-- Replace the email with your actual email address.

UPDATE public.users
SET plan = 'agency'
WHERE email = 'your-email@example.com';

-- Verify the change
SELECT id, email, name, plan, created_at
FROM public.users
WHERE email = 'your-email@example.com';


-- ── OPTION B: Create a brand-new admin user directly in the DB ──
-- Use this to create a test/admin account without going through
-- the email confirmation flow. Replace all placeholder values.

DO $$
DECLARE
  new_user_id UUID := gen_random_uuid();
BEGIN
  -- 1. Insert into Supabase auth.users (bypasses email confirmation)
  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    aud,
    role,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token
  ) VALUES (
    new_user_id,
    '00000000-0000-0000-0000-000000000000',
    'admin@yourdomain.com',                        -- ← change this
    crypt('YourSecurePassword123!', gen_salt('bf')), -- ← change this
    now(),                                          -- email pre-confirmed
    '{"provider":"email","providers":["email"]}',
    '{"name":"Admin"}',
    'authenticated',
    'authenticated',
    now(),
    now(),
    '',
    ''
  );

  -- 2. Create the matching public.users row with agency plan
  INSERT INTO public.users (id, email, name, plan)
  VALUES (new_user_id, 'admin@yourdomain.com', 'Admin', 'agency');

END $$;

-- Verify the new user
SELECT u.id, u.email, u.name, u.plan
FROM public.users u
WHERE u.email = 'admin@yourdomain.com';


-- ── OPTION C: Add admin flag to settings JSONB ──
-- Stores an is_admin flag in the user's settings column for
-- future role-based access control in the app.

UPDATE public.users
SET settings = settings || '{"is_admin": true}'::jsonb
WHERE email = 'your-email@example.com';

-- Check result
SELECT id, email, plan, settings
FROM public.users
WHERE email = 'your-email@example.com';


-- ── Useful admin queries ──────────────────────────────────────

-- List all users and their plans
SELECT id, email, name, plan, created_at
FROM public.users
ORDER BY created_at DESC;

-- List all connected Amazon profiles
SELECT
  ap.profile_id,
  ap.account_name,
  ap.marketplace,
  ap.last_sync_at,
  ap.sync_enabled,
  u.email AS owner_email
FROM public.amazon_profiles ap
JOIN public.users u ON u.id = ap.user_id
ORDER BY ap.created_at DESC;

-- Reset a user's password (Supabase Auth)
-- Do this via Dashboard → Authentication → Users → click user → Reset Password
-- Or via the Supabase CLI: supabase auth admin update-user <user_id> --password <new_password>

-- Delete a user completely (cascade deletes all their data via FK)
-- WARNING: Irreversible. Deletes all profiles, campaigns, sync logs, alerts.
-- DELETE FROM auth.users WHERE email = 'user@example.com';
