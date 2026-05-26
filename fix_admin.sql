INSERT INTO user_roles (user_id, role)
SELECT id, 'admin'
FROM auth.users
WHERE email = 'hsuwdkevin@gmail.com'
ON CONFLICT (user_id) DO UPDATE SET role = 'admin';

SELECT u.email, r.role
FROM auth.users u
JOIN user_roles r ON r.user_id = u.id;
