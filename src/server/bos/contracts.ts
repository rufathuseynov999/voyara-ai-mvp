import { z } from 'zod';
import { appRoles } from '@/server/auth/roles';

export const actorKinds = ['human', 'ai_agent', 'system'] as const;
export type ActorKind = (typeof actorKinds)[number];

export const commandEnvelopeSchema = z.object({
  commandId: z.uuid(),
  idempotencyKey: z.string().min(12).max(160),
  commandName: z.string().regex(/^[a-z][a-z0-9_.]+$/),
  requestedAt: z.iso.datetime({ offset: true }),
  actor: z.object({
    id: z.uuid(),
    kind: z.enum(actorKinds),
    roles: z.array(z.enum(appRoles)).max(appRoles.length)
  }),
  payload: z.unknown()
});

export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

export type CommandReceipt<Result = unknown> = {
  commandId: string;
  idempotencyKey: string;
  commandName: string;
  payloadHash: string;
  status: 'accepted';
  recordedAt: string;
  result: Result;
};

export type CommandAuditEvent = {
  eventId: string;
  commandId: string;
  commandName: string;
  actorId: string;
  actorKind: ActorKind;
  outcome: 'accepted' | 'denied';
  payloadHash: string;
  occurredAt: string;
  reasonCode?: string;
};

export interface AuditSink {
  append(event: CommandAuditEvent): Promise<void>;
}

export interface IdempotencyStore {
  find(idempotencyKey: string): Promise<CommandReceipt | null>;
  save(receipt: CommandReceipt): Promise<void>;
}

export type CommandHandler = (command: CommandEnvelope) => Promise<unknown>;
