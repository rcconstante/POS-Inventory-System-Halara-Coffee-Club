-- Run after creating both users in Supabase Authentication > Users.
update public.profiles p
set display_name = 'Richmond Constante', role = 'admin', updated_at = now()
from auth.users u
where p.id = u.id and lower(u.email) = 'r.constante.dev@gmail.com';

update public.profiles p
set display_name = 'Thesis Staff', role = 'staff', updated_at = now()
from auth.users u
where p.id = u.id and lower(u.email) = 'staff@halara.test';
