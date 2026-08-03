-- Synthetic local-development identities only. Never promote this seed to Production.
insert into auth.users (id, email, raw_user_meta_data)
values
  (
    '00000000-0000-4000-8000-000000000001'::uuid,
    'customer@voyara.example',
    '{"synthetic": true}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000002'::uuid,
    'founder@voyara.example',
    '{"synthetic": true}'::jsonb
  )
on conflict (id) do nothing;

insert into public.role_assignments (user_id, role, assigned_by)
values (
  '00000000-0000-4000-8000-000000000002'::uuid,
  'founder',
  '00000000-0000-4000-8000-000000000002'::uuid
)
on conflict (user_id, role) where active do nothing;
