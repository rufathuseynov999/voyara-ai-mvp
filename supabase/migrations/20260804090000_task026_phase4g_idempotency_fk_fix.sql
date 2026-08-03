-- Migration 26 — Phase 4G genuine schema deficiency fix.
--
-- GENUINE DEFECT: `workflow_idempotency_keys.workflow_run_id` and
-- `portal_task_idempotency_keys.portal_task_id` were both declared with a
-- hard, immediate `not null references ...` foreign key. This project's
-- own established reserve-first idempotency pattern (createWorkflowRun,
-- prepareTask, and every other reserve-first function in this codebase)
-- always reserves the idempotency key for a PROPOSED id BEFORE the
-- referenced row is created, then creates the row only if the
-- reservation won. Against a real foreign key, the reservation insert
-- itself fails, because the referenced row does not yet exist at that
-- moment.
--
-- A DEFERRABLE INITIALLY DEFERRED constraint was considered and rejected:
-- it only defers checking to the end of a single multi-statement
-- transaction. The reserve call and the row-creation call are each their
-- own separate PostgREST HTTP request — each is its own independently
-- auto-committed transaction — so a deferred constraint would still fail
-- at the end of the FIRST request, before the second ever runs. Deferring
-- would only work if both writes were wrapped in one explicit database
-- transaction (e.g. a single RPC), which neither store does.
--
-- FIX: drop the foreign key entirely. The idempotency key's own PRIMARY
-- KEY on `idempotency_key` is what actually provides the real
-- concurrency-safety guarantee (a duplicate reservation attempt hits the
-- primary key, not the foreign key) — the workflow_run_id/portal_task_id
-- columns remain, are still populated, and are still useful for lookup,
-- but no longer need to be enforced as an immediate reference. This was
-- invisible until SupabaseAutomationStore was tested against real
-- PostgreSQL for the first time in this session — every prior
-- reserve-first store either used InMemory stores (no FK enforcement) or
-- was tested in a way that happened not to exercise this exact ordering.

alter table public.workflow_idempotency_keys
  drop constraint workflow_idempotency_keys_workflow_run_id_fkey;

alter table public.portal_task_idempotency_keys
  drop constraint portal_task_idempotency_keys_portal_task_id_fkey;
