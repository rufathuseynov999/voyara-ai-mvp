-- Phase 4C — pre-release corrective migration.
--
-- Context: while implementing WhatsApp inbound message processing in this
-- same development phase (before this work was ever delivered as a
-- finished package), it became apparent that migration 18's
-- `messages_sent_requires_approval_or_policy` constraint had no exemption
-- for INBOUND messages — a customer's own message would be refused by the
-- database, since it carries no VOYARA approval and no auto-send policy
-- (neither is applicable: approval and policy-gating exist to control what
-- VOYARA sends outbound, not to gatekeep what a customer says to us).
--
-- Migration 18 itself is left exactly as it was originally applied —
-- immutable, per this project's discipline — and this migration makes the
-- one narrow correction on top of it: an INBOUND carve-out, and nothing
-- else. No outbound path gains any new way to reach `SENT`: the
-- human-approval branch and the policy-authorization branch are
-- byte-for-byte what migration 18 already established. A fresh database
-- running migrations 1–19 in order, and the existing development sandbox
-- (which already had this exact correction applied by hand during
-- development, before this migration existed) both converge on the
-- identical final constraint text below.

alter table public.messages drop constraint messages_sent_requires_approval_or_policy;
alter table public.messages add constraint messages_sent_requires_approval_or_policy check (
  status <> 'SENT' or
  direction = 'INBOUND' or
  (approved_by is not null and approved_at is not null) or
  (
    risk_class = 'LOW_RISK_INFORMATIONAL'
    and policy_id is not null
    and policy_hash is not null
    and knowledge_version is not null
    and model is not null
    and agent_run_id is not null
  )
);
