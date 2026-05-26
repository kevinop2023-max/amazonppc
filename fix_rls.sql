-- Enable RLS and allow users to read their own role
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read own role" ON user_roles;
CREATE POLICY "read own role" ON user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
