import type { Call } from './voice-contract';
import type { CallbackTaskRecord, CallEventRecord, CallStore } from './call-store';

export class InMemoryCallStore implements CallStore {
  private readonly calls = new Map<string, Call>();
  private readonly events: CallEventRecord[] = [];
  private readonly webhookReceipts = new Set<string>();
  private readonly callbackTasks: CallbackTaskRecord[] = [];

  async saveCall(call: Call): Promise<void> {
    this.calls.set(call.callId, call);
  }

  async loadCall(callId: string): Promise<Call | null> {
    return this.calls.get(callId) ?? null;
  }

  async recordCallEvent(event: CallEventRecord): Promise<void> {
    this.events.push(event);
  }

  async reserveWebhookReceipt(record: { eventId: string }): Promise<{ winner: boolean }> {
    if (this.webhookReceipts.has(record.eventId)) return { winner: false };
    this.webhookReceipts.add(record.eventId);
    return { winner: true };
  }

  async createCallbackTask(task: CallbackTaskRecord): Promise<void> {
    this.callbackTasks.push(task);
  }

  /** Test helpers. */
  eventsFor(callId: string): CallEventRecord[] {
    return this.events.filter((e) => e.callId === callId);
  }
  callbackTasksFor(callId: string): CallbackTaskRecord[] {
    return this.callbackTasks.filter((t) => t.callId === callId);
  }
}
