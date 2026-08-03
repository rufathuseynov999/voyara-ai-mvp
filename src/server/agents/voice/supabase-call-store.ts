import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { Call } from './voice-contract';
import type { CallbackTaskRecord, CallEventRecord, CallStore } from './call-store';

export class SupabaseCallStore implements CallStore {
  private admin() {
    const client = createAdminSupabaseClient();
    if (!client) throw new Error('CALL_STORE_UNAVAILABLE: Supabase admin client is not configured.');
    return client;
  }

  async saveCall(call: Call): Promise<void> {
    const { error } = await this.admin().from('calls').upsert({
      id: call.callId,
      conversation_id: call.conversationId,
      contact_id: call.contactId,
      voice_number_id: call.voiceNumberId,
      brand: call.brand,
      called_number: call.calledNumber,
      caller_number: call.callerNumber,
      status: call.status,
      detected_language: call.detectedLanguage,
      duration_seconds: call.durationSeconds,
      transcript: call.transcript,
      ai_summary: call.aiSummary,
      urgency: call.urgency,
      transfer_status: call.transferStatus,
      assigned_owner_id: call.assignedOwnerId,
      handover_status: call.handoverStatus,
      consent_ai_disclosure: call.consent.aiDisclosure,
      consent_recording: call.consent.recording,
      consent_transcription: call.consent.transcription,
      consent_crm_storage: call.consent.crmStorage,
      consent_follow_up: call.consent.followUp,
      recording_enabled: call.recordingEnabled,
      model_tier: call.modelTier,
      model_name: call.modelName,
      estimated_cost_minor_units: call.estimatedCostMinorUnits,
      duration_ceiling_seconds: call.durationCeilingSeconds,
      correlation_id: call.correlationId,
      started_at: call.startedAt,
      ended_at: call.endedAt
    }, { onConflict: 'id' });
    if (error) throw new Error(`CALL_WRITE_FAILED:${error.code}`);
  }

  async loadCall(callId: string): Promise<Call | null> {
    const { data, error } = await this.admin().from('calls').select('*').eq('id', callId).maybeSingle();
    if (error) throw new Error(`CALL_READ_FAILED:${error.code}`);
    if (!data) return null;
    return {
      callId: data.id,
      conversationId: data.conversation_id,
      contactId: data.contact_id,
      voiceNumberId: data.voice_number_id,
      brand: data.brand,
      calledNumber: data.called_number,
      callerNumber: data.caller_number,
      status: data.status,
      detectedLanguage: data.detected_language,
      durationSeconds: data.duration_seconds,
      transcript: data.transcript,
      aiSummary: data.ai_summary,
      urgency: data.urgency,
      transferStatus: data.transfer_status,
      assignedOwnerId: data.assigned_owner_id,
      handoverStatus: data.handover_status,
      consent: {
        aiDisclosure: data.consent_ai_disclosure,
        recording: data.consent_recording,
        transcription: data.consent_transcription,
        crmStorage: data.consent_crm_storage,
        followUp: data.consent_follow_up
      },
      recordingEnabled: data.recording_enabled,
      modelTier: data.model_tier,
      modelName: data.model_name,
      estimatedCostMinorUnits: data.estimated_cost_minor_units,
      durationCeilingSeconds: data.duration_ceiling_seconds,
      correlationId: data.correlation_id,
      startedAt: data.started_at,
      endedAt: data.ended_at
    };
  }

  async recordCallEvent(event: CallEventRecord): Promise<void> {
    const { error } = await this.admin().from('call_events').insert({
      id: event.eventId,
      call_id: event.callId,
      kind: event.kind,
      actor_id: event.actorId,
      actor_kind: event.actorKind,
      correlation_id: event.correlationId,
      reason_code: event.reasonCode ?? null
    });
    if (error) throw new Error(`CALL_EVENT_WRITE_FAILED:${error.code}`);
  }

  async reserveWebhookReceipt(record: { eventId: string; callId: string | null; eventType: string; accepted: boolean; reasonCode: string | null; correlationId: string }): Promise<{ winner: boolean }> {
    const { error } = await this.admin().from('call_webhook_receipts').insert({
      id: crypto.randomUUID(),
      event_id: record.eventId,
      call_id: record.callId,
      event_type: record.eventType,
      accepted: record.accepted,
      reason_code: record.reasonCode,
      correlation_id: record.correlationId
    });
    if (!error) return { winner: true };
    if (error.code === '23505') return { winner: false };
    throw new Error(`CALL_WEBHOOK_RECEIPT_FAILED:${error.code}`);
  }

  async createCallbackTask(task: CallbackTaskRecord): Promise<void> {
    const { error } = await this.admin().from('callback_tasks').insert({
      id: task.taskId,
      call_id: task.callId,
      contact_id: task.contactId,
      due_at: task.dueAt,
      status: task.status,
      assigned_owner_id: task.assignedOwnerId,
      notes: task.notes,
      correlation_id: task.correlationId,
      created_at: task.createdAt
    });
    if (error) throw new Error(`CALLBACK_TASK_WRITE_FAILED:${error.code}`);
  }
}
