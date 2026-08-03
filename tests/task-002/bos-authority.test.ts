import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AuthorityError } from '@/server/bos/authority';
import { canonicalJson, sha256 } from '@/server/bos/canonical-json';
import { CommandGateway } from '@/server/bos/command-gateway';
import type { AuditSink, CommandAuditEvent, CommandEnvelope, CommandReceipt, IdempotencyStore } from '@/server/bos/contracts';

class MemoryIdempotency implements IdempotencyStore {
  readonly receipts = new Map<string, CommandReceipt>();
  async find(key: string) {
    return this.receipts.get(key) ?? null;
  }
  async save(receipt: CommandReceipt) {
    this.receipts.set(receipt.idempotencyKey, receipt);
  }
}

class MemoryAudit implements AuditSink {
  readonly events: CommandAuditEvent[] = [];
  async append(event: CommandAuditEvent) {
    this.events.push(event);
  }
}

function command(overrides: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    commandId: randomUUID(),
    idempotencyKey: `test-${randomUUID()}`,
    commandName: 'foundation.record_check',
    requestedAt: '2026-07-17T08:00:00.000Z',
    actor: {
      id: '00000000-0000-4000-8000-000000000002',
      kind: 'human',
      roles: ['founder']
    },
    payload: { status: 'ready' },
    ...overrides
  };
}

test('canonical JSON and SHA-256 are stable across object key order', () => {
  assert.equal(canonicalJson({ b: 2, a: { z: true, y: 1 } }), '{"a":{"y":1,"z":true},"b":2}');
  assert.equal(sha256({ b: 2, a: 1 }), sha256({ a: 1, b: 2 }));
  assert.match(sha256({ exact: 'payload' }), /^[0-9a-f]{64}$/);
});

test('an AI agent cannot execute a human-only Payment Verification command', async () => {
  const audit = new MemoryAudit();
  const gateway = new CommandGateway(new Map(), new MemoryIdempotency(), audit);
  await assert.rejects(
    gateway.execute(
      command({
        commandName: 'payment.verify',
        actor: {
          id: '00000000-0000-4000-8000-000000000099',
          kind: 'ai_agent',
          roles: ['finance']
        }
      })
    ),
    AuthorityError
  );
  assert.equal(audit.events.length, 1);
  assert.equal(audit.events[0]?.outcome, 'denied');
  assert.equal(audit.events[0]?.reasonCode, 'AUTHORITY_DENIED');
});

test('Role assignment requires a human Founder', async () => {
  const audit = new MemoryAudit();
  const handlerCalls: CommandEnvelope[] = [];
  const gateway = new CommandGateway(
    new Map([
      [
        'role.assign',
        async (input: CommandEnvelope) => {
          handlerCalls.push(input);
          return { recorded: true };
        }
      ]
    ]),
    new MemoryIdempotency(),
    audit,
    () => new Date('2026-07-17T08:30:00.000Z')
  );

  await assert.rejects(
    gateway.execute(command({ commandName: 'role.assign', actor: { ...command().actor, roles: ['admin'] } })),
    AuthorityError
  );
  const accepted = await gateway.execute(command({ commandName: 'role.assign' }));
  assert.equal(accepted.status, 'accepted');
  assert.equal(handlerCalls.length, 1);
  assert.equal(audit.events.at(-1)?.outcome, 'accepted');
});

test('idempotent command replay returns the original receipt and payload drift is rejected', async () => {
  const idempotency = new MemoryIdempotency();
  const audit = new MemoryAudit();
  let handlerCount = 0;
  const gateway = new CommandGateway(
    new Map([
      [
        'foundation.record_check',
        async () => {
          handlerCount += 1;
          return { check: 'recorded' };
        }
      ]
    ]),
    idempotency,
    audit,
    () => new Date('2026-07-17T08:30:00.000Z')
  );
  const input = command();
  const first = await gateway.execute(input);
  const replay = await gateway.execute(input);
  assert.deepEqual(replay, first);
  assert.equal(handlerCount, 1);
  assert.equal(audit.events.length, 1);

  await assert.rejects(gateway.execute({ ...input, payload: { status: 'changed' } }), /IDEMPOTENCY_CONFLICT/);
});
