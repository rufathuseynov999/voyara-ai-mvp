import { randomUUID } from 'node:crypto';
import { assertCommandAuthority, AuthorityError } from './authority';
import { sha256 } from './canonical-json';
import {
  commandEnvelopeSchema,
  type AuditSink,
  type CommandEnvelope,
  type CommandHandler,
  type CommandReceipt,
  type IdempotencyStore
} from './contracts';

export class CommandGateway {
  constructor(
    private readonly handlers: ReadonlyMap<string, CommandHandler>,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditSink,
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(input: unknown): Promise<CommandReceipt> {
    const command = commandEnvelopeSchema.parse(input);
    const payloadHash = sha256(command.payload);
    const existing = await this.idempotency.find(command.idempotencyKey);
    if (existing) {
      if (existing.commandName !== command.commandName || existing.payloadHash !== payloadHash) {
        throw new Error('IDEMPOTENCY_CONFLICT');
      }
      return existing;
    }

    try {
      assertCommandAuthority(command);
    } catch (error) {
      if (error instanceof AuthorityError) {
        await this.recordAudit(command, payloadHash, 'denied', error.code);
      }
      throw error;
    }

    const handler = this.handlers.get(command.commandName);
    if (!handler) throw new Error(`UNREGISTERED_COMMAND:${command.commandName}`);
    const result = await handler(command);
    const receipt: CommandReceipt = {
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      commandName: command.commandName,
      payloadHash,
      status: 'accepted',
      recordedAt: this.now().toISOString(),
      result
    };

    await this.idempotency.save(receipt);
    await this.recordAudit(command, payloadHash, 'accepted');
    return receipt;
  }

  private async recordAudit(
    command: CommandEnvelope,
    payloadHash: string,
    outcome: 'accepted' | 'denied',
    reasonCode?: string
  ) {
    await this.audit.append({
      eventId: randomUUID(),
      commandId: command.commandId,
      commandName: command.commandName,
      actorId: command.actor.id,
      actorKind: command.actor.kind,
      outcome,
      payloadHash,
      occurredAt: this.now().toISOString(),
      reasonCode
    });
  }
}
