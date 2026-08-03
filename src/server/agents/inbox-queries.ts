import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { Viewer } from '@/server/auth/viewer';

/**
 * Phase 4B — CRM inbox read queries. Every function here requires an AAL2
 * staff `Viewer` (already enforced by the caller page via
 * requireAssuranceLevel) and reads only through the admin client — matching
 * every other staff read-model in this project (loadAdministrationSnapshot,
 * loadStaffTravelRequestQueue). No cross-customer leakage is possible here
 * for a structural reason: this is explicitly a staff-only internal view —
 * there is no customer-facing code path that calls these functions at all.
 */

const SLA_THRESHOLD_HOURS = 2;

export type InboxConversationSummary = {
  conversationId: string;
  contactId: string;
  contactName: string | null;
  channel: string;
  customerFacingBrand: 'RTRAVEL' | 'VOYARA' | null;
  status: string;
  handoverStatus: 'AI' | 'HUMAN';
  assignedOwnerId: string | null;
  preferredLocale: string | null;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastReadAt: string | null;
  unread: boolean;
  slaOverdue: boolean;
  createdAt: string;
};

function computeUnread(lastMessageAt: string | null, lastReadAt: string | null): boolean {
  if (!lastMessageAt) return false;
  if (!lastReadAt) return true;
  return Date.parse(lastMessageAt) > Date.parse(lastReadAt);
}

function computeSlaOverdue(lastInboundAt: string | null, handoverStatus: 'AI' | 'HUMAN'): boolean {
  // SLA only applies once a conversation needs a human — an AI actively
  // handling a conversation isn't "overdue" by this measure.
  if (handoverStatus !== 'HUMAN' || !lastInboundAt) return false;
  const hoursSince = (Date.now() - Date.parse(lastInboundAt)) / 3_600_000;
  return hoursSince > SLA_THRESHOLD_HOURS;
}

export async function markConversationRead(conversationId: string, readAt: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  if (!admin) return;
  await admin.from('conversations').update({ last_read_at: readAt }).eq('id', conversationId);
}

export type InboxFilters = {
  brand?: 'RTRAVEL' | 'VOYARA';
  channel?: string;
  language?: string;
  status?: string;
  assignedOwnerId?: string;
  callStatus?: string;
  transferred?: boolean;
  callbackRequired?: boolean;
  urgency?: string;
};

export type VoiceCallDetail = {
  callId: string;
  calledNumber: string;
  callerNumber: string;
  brand: 'RTRAVEL' | 'VOYARA';
  status: string;
  detectedLanguage: string | null;
  durationSeconds: number | null;
  transcript: string | null;
  aiSummary: string | null;
  urgency: string | null;
  transferStatus: string | null;
  handoverStatus: 'AI' | 'HUMAN';
  consent: { aiDisclosure: string; recording: string; transcription: string; crmStorage: string; followUp: string };
  recordingEnabled: boolean;
  startedAt: string;
  endedAt: string | null;
  callbackTasks: Array<{ taskId: string; dueAt: string; status: string; notes: string | null }>;
  callEvents: Array<{ kind: string; actorKind: string; reasonCode: string | null; occurredAt: string }>;
};

/** Voice-specific detail — only meaningful for `channel === 'VOICE'`
 *  conversations. A separate function (not folded into
 *  loadInboxConversationDetail's return shape) because a voice call's brand
 *  lives on `calls.brand`, independent of `conversations.customer_facing_
 *  brand` (which is set for chat/WhatsApp/Instagram conversations, not
 *  calls) — keeping this separate avoids conflating the two. */
export async function loadVoiceCallForConversation(conversationId: string): Promise<VoiceCallDetail | null> {
  const admin = createAdminSupabaseClient();
  if (!admin) return null;

  const { data: call, error } = await admin.from('calls').select('*').eq('conversation_id', conversationId).maybeSingle();
  if (error) throw new Error(`VOICE_CALL_DETAIL_FAILED:${error.code}`);
  if (!call) return null;

  const [{ data: callbackTasks }, { data: callEvents }] = await Promise.all([
    admin.from('callback_tasks').select('id, due_at, status, notes').eq('call_id', call.id).order('due_at', { ascending: true }),
    admin.from('call_events').select('kind, actor_kind, reason_code, occurred_at').eq('call_id', call.id).order('occurred_at', { ascending: true })
  ]);

  return {
    callId: call.id,
    calledNumber: call.called_number,
    callerNumber: call.caller_number,
    brand: call.brand,
    status: call.status,
    detectedLanguage: call.detected_language,
    durationSeconds: call.duration_seconds,
    transcript: call.transcript,
    aiSummary: call.ai_summary,
    urgency: call.urgency,
    transferStatus: call.transfer_status,
    handoverStatus: call.handover_status,
    consent: {
      aiDisclosure: call.consent_ai_disclosure, recording: call.consent_recording, transcription: call.consent_transcription,
      crmStorage: call.consent_crm_storage, followUp: call.consent_follow_up
    },
    recordingEnabled: call.recording_enabled,
    startedAt: call.started_at,
    endedAt: call.ended_at,
    callbackTasks: (callbackTasks ?? []).map((t) => ({ taskId: t.id, dueAt: t.due_at, status: t.status, notes: t.notes })),
    callEvents: (callEvents ?? []).map((e) => ({ kind: e.kind, actorKind: e.actor_kind, reasonCode: e.reason_code, occurredAt: e.occurred_at }))
  };
}

/** Applies voice-specific filters (call status / transferred / callback
 *  required / urgency) by first resolving the matching `conversation_id`s
 *  from `calls`, then intersecting with the caller's conversation id list.
 *  Returns null (meaning "no voice filter active") when none of the voice
 *  filters are set, so callers can skip the extra query entirely. */
export async function resolveVoiceFilteredConversationIds(filters: InboxFilters): Promise<Set<string> | null> {
  if (!filters.callStatus && filters.transferred === undefined && filters.callbackRequired === undefined && !filters.urgency) return null;
  const admin = createAdminSupabaseClient();
  if (!admin) return new Set();

  let query = admin.from('calls').select('conversation_id, id, status, transfer_status, urgency');
  if (filters.callStatus) query = query.eq('status', filters.callStatus);
  if (filters.urgency) query = query.eq('urgency', filters.urgency);
  if (filters.transferred === true) query = query.eq('status', 'TRANSFERRED');
  const { data } = await query;
  let rows = data ?? [];

  if (filters.callbackRequired !== undefined) {
    const callIds = rows.map((r) => r.id);
    const { data: tasks } = await admin.from('callback_tasks').select('call_id, status').in('call_id', callIds.length ? callIds : ['00000000-0000-0000-0000-000000000000']);
    const pendingCallIds = new Set((tasks ?? []).filter((t) => t.status === 'PENDING').map((t) => t.call_id));
    rows = filters.callbackRequired ? rows.filter((r) => pendingCallIds.has(r.id)) : rows.filter((r) => !pendingCallIds.has(r.id));
  }

  return new Set(rows.map((r) => r.conversation_id));
}

export async function loadInboxConversations(viewer: Viewer, filters: InboxFilters = {}): Promise<InboxConversationSummary[]> {
  const admin = createAdminSupabaseClient();
  if (!admin) return [];

  let query = admin
    .from('conversations')
    .select('id, contact_id, channel, customer_facing_brand, status, handover_status, assigned_owner_id, last_message_at, last_inbound_at, last_read_at, created_at, contacts(display_name, preferred_locale)')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(200);

  if (filters.brand) query = query.eq('customer_facing_brand', filters.brand);
  if (filters.channel) query = query.eq('channel', filters.channel);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.assignedOwnerId) query = query.eq('assigned_owner_id', filters.assignedOwnerId);

  const { data, error } = await query;
  if (error) throw new Error(`INBOX_QUERY_FAILED:${error.code}`);

  const voiceFilteredIds = await resolveVoiceFilteredConversationIds(filters);

  const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { contacts: { display_name: string | null; preferred_locale: string | null } | null }>;
  const filteredRows = voiceFilteredIds ? rows.filter((r) => voiceFilteredIds.has(r.id as string)) : rows;
  const mapped = filteredRows.map((row) => {
    const lastMessageAt = row.last_message_at as string | null;
    const lastReadAt = row.last_read_at as string | null;
    const lastInboundAt = row.last_inbound_at as string | null;
    const handoverStatus = row.handover_status as InboxConversationSummary['handoverStatus'];
    return {
      conversationId: row.id as string,
      contactId: row.contact_id as string,
      contactName: row.contacts?.display_name ?? null,
      channel: row.channel as string,
      customerFacingBrand: row.customer_facing_brand as InboxConversationSummary['customerFacingBrand'],
      status: row.status as string,
      handoverStatus,
      assignedOwnerId: row.assigned_owner_id as string | null,
      preferredLocale: row.contacts?.preferred_locale ?? null,
      lastMessageAt,
      lastInboundAt,
      lastReadAt,
      unread: computeUnread(lastMessageAt, lastReadAt),
      slaOverdue: computeSlaOverdue(lastInboundAt, handoverStatus),
      createdAt: row.created_at as string
    };
  });

  return filters.language ? mapped.filter((m) => m.preferredLocale === filters.language) : mapped;
}

export type InboxConversationDetail = InboxConversationSummary & {
  linkedIdentities: Array<{ identityKind: string; externalId: string; verified: boolean }>;
  messages: Array<{ messageId: string; direction: string; senderKind: string; body: string; status: string; createdAt: string }>;
  paymentLinks: Array<{ paymentLinkId: string; orderReference: string; status: string; amountMinor: number; currency: string; transactionType: string }>;
};

export async function loadInboxConversationDetail(viewer: Viewer, conversationId: string): Promise<InboxConversationDetail | null> {
  const admin = createAdminSupabaseClient();
  if (!admin) return null;

  const { data: conversation, error: convError } = await admin
    .from('conversations')
    .select('id, contact_id, channel, customer_facing_brand, status, handover_status, assigned_owner_id, last_message_at, last_inbound_at, last_read_at, created_at, contacts(display_name, preferred_locale)')
    .eq('id', conversationId)
    .maybeSingle();
  if (convError) throw new Error(`INBOX_DETAIL_FAILED:${convError.code}`);
  if (!conversation) return null;
  const contact = (conversation as unknown as { contacts: { display_name: string | null; preferred_locale: string | null } | null }).contacts;

  const [{ data: identities }, { data: messages }, { data: links }] = await Promise.all([
    admin.from('linked_identities').select('identity_kind, external_id, verified').eq('contact_id', conversation.contact_id),
    admin.from('messages').select('id, direction, sender_kind, body, status, created_at').eq('conversation_id', conversationId).order('created_at', { ascending: true }),
    admin.from('payment_link_requests').select('id, order_reference, status, amount_minor, currency, transaction_type').eq('originating_conversation_id', conversationId)
  ]);

  return {
    conversationId: conversation.id,
    contactId: conversation.contact_id,
    contactName: contact?.display_name ?? null,
    channel: conversation.channel,
    customerFacingBrand: conversation.customer_facing_brand,
    status: conversation.status,
    lastInboundAt: conversation.last_inbound_at,
    lastReadAt: conversation.last_read_at,
    unread: computeUnread(conversation.last_message_at, conversation.last_read_at),
    slaOverdue: computeSlaOverdue(conversation.last_inbound_at, conversation.handover_status),
    handoverStatus: conversation.handover_status,
    assignedOwnerId: conversation.assigned_owner_id,
    preferredLocale: contact?.preferred_locale ?? null,
    lastMessageAt: conversation.last_message_at,
    createdAt: conversation.created_at,
    linkedIdentities: (identities ?? []).map((i) => ({ identityKind: i.identity_kind, externalId: i.external_id, verified: i.verified })),
    messages: (messages ?? []).map((m) => ({ messageId: m.id, direction: m.direction, senderKind: m.sender_kind, body: m.body, status: m.status, createdAt: m.created_at })),
    paymentLinks: (links ?? []).map((l) => ({ paymentLinkId: l.id, orderReference: l.order_reference, status: l.status, amountMinor: l.amount_minor, currency: l.currency, transactionType: l.transaction_type }))
  };
}
