-- Task 012 closes default privilege gaps without changing domain authority.
-- Browser roles retain only privileges explicitly re-granted by prior migrations.

revoke create on schema public from public, anon, authenticated;
revoke usage on schema private from public, anon, authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke all on sequences from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

comment on schema public is
  'VOYARA exposed schema. Creation and function execution are denied by default; every API privilege must be explicit.';

comment on schema private is
  'VOYARA internal authority schema. Browser roles have no schema usage and no default object privileges.';
