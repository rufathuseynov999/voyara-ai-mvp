import type { PortalTask } from './portal-task-contract';

export interface PortalTaskStore {
  saveTask(task: PortalTask): Promise<void>;
  loadTask(portalTaskId: string): Promise<PortalTask | null>;
  recordTaskEvent(event: PortalTaskEventRecord): Promise<void>;
  reserveIdempotencyKey(key: string, portalTaskId: string, correlationId: string): Promise<{ winner: boolean; portalTaskId: string }>;
}

export type PortalTaskEventRecord = {
  eventId: string;
  portalTaskId: string;
  kind: string;
  actorId: string;
  actorKind: 'human' | 'agent' | 'system';
  correlationId: string;
  reasonCode?: string | null;
};

export class InMemoryPortalTaskStore implements PortalTaskStore {
  private readonly tasks = new Map<string, PortalTask>();
  private readonly events: PortalTaskEventRecord[] = [];
  private readonly idempotencyKeys = new Map<string, string>();

  async saveTask(task: PortalTask): Promise<void> {
    this.tasks.set(task.portalTaskId, task);
  }
  async loadTask(portalTaskId: string): Promise<PortalTask | null> {
    return this.tasks.get(portalTaskId) ?? null;
  }
  async recordTaskEvent(event: PortalTaskEventRecord): Promise<void> {
    this.events.push(event);
  }
  async reserveIdempotencyKey(key: string, portalTaskId: string): Promise<{ winner: boolean; portalTaskId: string }> {
    const existing = this.idempotencyKeys.get(key);
    if (existing) return { winner: false, portalTaskId: existing };
    this.idempotencyKeys.set(key, portalTaskId);
    return { winner: true, portalTaskId };
  }

  eventsFor(portalTaskId: string): PortalTaskEventRecord[] {
    return this.events.filter((e) => e.portalTaskId === portalTaskId);
  }
}
