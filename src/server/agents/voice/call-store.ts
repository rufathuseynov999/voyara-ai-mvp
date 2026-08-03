import type { Call } from './voice-contract';

/** Phase 4D — call store port. Mirrors ConversationStore/PaymentLinkStore design. */
export interface CallStore {
  saveCall(call: Call): Promise<void>;
  loadCall(callId: string): Promise<Call | null>;
  recordCallEvent(event: CallEventRecord): Promise<void>;
  reserveWebhookReceipt(record: { eventId: string; callId: string | null; eventType: string; accepted: boolean; reasonCode: string | null; correlationId: string }): Promise<{ winner: boolean }>;
  createCallbackTask(task: CallbackTaskRecord): Promise<void>;
}

export type CallEventRecord = {
  eventId: string;
  callId: string;
  kind: string;
  actorId: string;
  actorKind: 'human' | 'agent' | 'system';
  correlationId: string;
  reasonCode?: string | null;
};

export type CallbackTaskRecord = {
  taskId: string;
  callId: string;
  contactId: string;
  dueAt: string;
  status: string;
  assignedOwnerId: string | null;
  notes: string | null;
  correlationId: string;
  createdAt: string;
};
