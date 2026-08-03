# VOYARA AI — Initial Founder Bootstrap Runbook

This procedure creates the first real Founder Role after all migrations have been applied to a new environment. It is a one-time database-administrator action. It must never use the local synthetic seed.

## Preconditions

1. Rufat Huseynov registers through the real VOYARA Customer login using the approved Founder email.
2. The email is verified through the trusted Production SMTP sender.
3. A database administrator confirms the exact `auth.users.id`, normalized email and `email_confirmed_at` in the Supabase dashboard.
4. The environment has no active Founder assignment.
5. A change ticket/correlation UUID and a second human reviewer are recorded.

## Staging rehearsal

Perform the complete procedure in staging first. Replace every placeholder in the transaction below. Do not paste a real email into source control.

```sql
begin;

do $$
begin
  if exists (
    select 1 from public.role_assignments
    where role = 'founder' and active
  ) then
    raise exception 'Active Founder already exists; bootstrap is forbidden';
  end if;
end;
$$;

-- Verify the supplied UUID belongs to the already-confirmed real Founder identity.
select id, email, email_confirmed_at
from auth.users
where id = '<FOUNDER_USER_UUID>'::uuid
for update;

insert into public.role_assignments (user_id, role, assigned_by, reason)
values (
  '<FOUNDER_USER_UUID>'::uuid,
  'founder',
  '<FOUNDER_USER_UUID>'::uuid,
  'INITIAL_FOUNDER_BOOTSTRAP:<APPROVED_CHANGE_TICKET>'
);

insert into public.authority_audit_events (
  event_id, correlation_id, actor_id, actor_session_id, actor_aal,
  event_type, outcome, reason_code, entity_type, entity_id,
  payload_hash, metadata
)
select
  gen_random_uuid(),
  '<CORRELATION_UUID>'::uuid,
  '<FOUNDER_USER_UUID>'::uuid,
  null,
  null,
  'founder.initial_bootstrap',
  'accepted',
  null,
  'role_assignment',
  '<FOUNDER_USER_UUID>:founder',
  encode(sha256(convert_to(payload::text, 'UTF8')), 'hex'),
  payload
from (
  select jsonb_build_object(
    'schemaVersion', 'founder-bootstrap-v1',
    'userId', '<FOUNDER_USER_UUID>',
    'role', 'founder',
    'changeTicket', '<APPROVED_CHANGE_TICKET>',
    'reviewer', '<SECOND_HUMAN_REVIEWER>'
  ) as payload
) evidence;

commit;
```

If the identity query returns no confirmed user, or any placeholder remains, roll back and stop.

## Post-bootstrap proof

1. Sign out all existing Founder browser sessions and sign in again.
2. Enrol TOTP and complete an AAL2 challenge.
3. Confirm `/{locale}/staff/founder` and `/{locale}/staff/founder/access` load only after AAL2.
4. Confirm the active Founder assignment and immutable audit event exist.
5. Confirm an ordinary Customer cannot read another person’s Role, session, proposal, Payment, Booking, Voucher or Support records.
6. Store the change record outside the repository with restricted access.

All later Role changes must use the Founder access console and its audited exact commands. Do not repeat database bootstrap.
