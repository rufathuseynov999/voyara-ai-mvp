import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { Viewer } from '@/server/auth/viewer';
import { sha256 } from '@/server/bos/canonical-json';
import {
  buildCanonicalSupportCaseEventPayload,
  buildCanonicalSupportCaseOpenPayload,
  type CustomerSupportCommand,
  type StaffSupportCommand,
  type SupportCommandResult,
  type SupportEscalationLevel,
  type SupportEventType,
  type SupportPriority
} from './contract';

type IssuedBookingRow = {
  id: string;
  customer_id: string;
  locale: 'az' | 'ru' | 'en';
  status: string;
  voucher_id: string | null;
  voucher_version: number | null;
  voucher_hash: string | null;
};

type VoucherRow = {
  id: string;
  booking_id: string;
  customer_id: string;
  status: string;
  issued_version: number | null;
  issued_hash: string | null;
};

type SupportCaseRow = {
  id: string;
  customer_id: string;
  status: string;
  priority: SupportPriority;
  escalation_level: SupportEscalationLevel;
  case_authority_hash: string;
  current_event_sequence: number;
  current_event_hash: string;
};

async function loadSupportCase(caseId: string): Promise<SupportCaseRow> {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error('SUPPORT_CONFIGURATION_UNAVAILABLE');
  const { data, error } = await admin
    .from('support_cases')
    .select([
      'id', 'customer_id', 'status', 'priority', 'escalation_level',
      'case_authority_hash', 'current_event_sequence', 'current_event_hash'
    ].join(', '))
    .eq('id', caseId)
    .maybeSingle();
  if (error || !data) throw new Error('SUPPORT_CASE_NOT_FOUND');
  return data as unknown as SupportCaseRow;
}

function staffEvent(input: StaffSupportCommand): {
  eventType: Exclude<SupportEventType, 'CASE_OPENED'>;
  visibility: 'CUSTOMER' | 'INTERNAL';
  message: string;
  nextStatus?: 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED';
  priority?: SupportPriority;
  escalationLevel?: SupportEscalationLevel;
} {
  switch (input.action) {
    case 'support.case.claim':
      return {
        eventType: 'CASE_CLAIMED',
        visibility: 'INTERNAL',
        message: 'Case claimed by an accountable human owner.'
      };
    case 'support.case.priority.set':
      return {
        eventType: 'PRIORITY_CHANGED',
        visibility: 'INTERNAL',
        message: input.reason,
        priority: input.priority
      };
    case 'support.case.escalate':
      return {
        eventType: 'CASE_ESCALATED',
        visibility: 'INTERNAL',
        message: input.reason,
        escalationLevel: input.targetLevel
      };
    case 'support.case.customer_update':
      return {
        eventType: 'CUSTOMER_UPDATE',
        visibility: 'CUSTOMER',
        message: input.message,
        nextStatus: input.nextStatus
      };
    case 'support.case.internal_note':
      return {
        eventType: 'INTERNAL_NOTE',
        visibility: 'INTERNAL',
        message: input.message
      };
    case 'support.case.resolve':
      return {
        eventType: 'CASE_RESOLVED',
        visibility: 'CUSTOMER',
        message: input.resolution,
        nextStatus: 'RESOLVED'
      };
    case 'support.case.close':
      return {
        eventType: 'CASE_CLOSED',
        visibility: 'CUSTOMER',
        message: input.closureNote,
        nextStatus: 'CLOSED'
      };
  }
}

export async function executeSupportCommand(
  viewer: Viewer,
  input: CustomerSupportCommand | StaffSupportCommand,
  idempotencyKey: string
): Promise<SupportCommandResult> {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error('SUPPORT_CONFIGURATION_UNAVAILABLE');
  const commandId = randomUUID();
  let payload: Record<string, unknown>;

  if (input.action === 'support.case.open') {
    const [bookingResult, voucherResult] = await Promise.all([
      admin.from('bookings')
        .select('id, customer_id, locale, status, voucher_id, voucher_version, voucher_hash')
        .eq('id', input.bookingId)
        .maybeSingle(),
      admin.from('vouchers')
        .select('id, booking_id, customer_id, status, issued_version, issued_hash')
        .eq('booking_id', input.bookingId)
        .maybeSingle()
    ]);
    if (bookingResult.error || !bookingResult.data || voucherResult.error || !voucherResult.data) {
      throw new Error('ISSUED_VOUCHER_REQUIRED');
    }
    const booking = bookingResult.data as unknown as IssuedBookingRow;
    const voucher = voucherResult.data as unknown as VoucherRow;
    if (
      booking.customer_id !== viewer.id
      || booking.status !== 'VOUCHER_ISSUED'
      || !booking.voucher_id || !booking.voucher_version || !booking.voucher_hash
      || voucher.id !== booking.voucher_id
      || voucher.booking_id !== booking.id
      || voucher.customer_id !== viewer.id
      || voucher.status !== 'ISSUED'
      || voucher.issued_version !== booking.voucher_version
      || voucher.issued_hash !== booking.voucher_hash
    ) throw new Error('ISSUED_VOUCHER_REQUIRED');

    const casePayload = buildCanonicalSupportCaseOpenPayload({
      caseId: commandId,
      bookingId: booking.id,
      voucherId: booking.voucher_id,
      voucherVersion: booking.voucher_version,
      voucherHash: booking.voucher_hash,
      customerId: viewer.id,
      locale: booking.locale,
      category: input.category,
      urgency: input.urgency,
      subject: input.subject,
      message: input.message,
      declarationConfirmed: input.declarationConfirmed
    });
    payload = {
      caseId: commandId,
      bookingId: booking.id,
      voucherId: booking.voucher_id,
      voucherVersion: booking.voucher_version,
      voucherHash: booking.voucher_hash,
      casePayload,
      caseAuthorityHash: sha256(casePayload)
    };
  } else {
    const supportCase = await loadSupportCase(input.caseId);
    if (
      (input.action === 'support.case.message' && supportCase.customer_id !== viewer.id)
      || (input.action !== 'support.case.message' && viewer.roles.includes('customer')
        && !viewer.roles.some((role) => ['staff', 'manager', 'admin', 'founder'].includes(role)))
    ) throw new Error('SUPPORT_CASE_NOT_FOUND');

    const event = input.action === 'support.case.message'
      ? {
          eventType: 'CUSTOMER_MESSAGE' as const,
          visibility: 'CUSTOMER' as const,
          message: input.message
        }
      : staffEvent(input);
    const eventPayload = buildCanonicalSupportCaseEventPayload({
      caseId: supportCase.id,
      caseAuthorityHash: supportCase.case_authority_hash,
      eventSequence: supportCase.current_event_sequence + 1,
      previousEventHash: supportCase.current_event_hash,
      ...event
    });
    payload = {
      caseId: supportCase.id,
      eventPayload,
      eventHash: sha256(eventPayload)
    };
  }

  const { data, error } = await admin.rpc('execute_support_command', {
    p_command_id: commandId,
    p_idempotency_key: idempotencyKey,
    p_command_name: input.action,
    p_actor_id: viewer.id,
    p_actor_session_id: viewer.sessionId,
    p_actor_aal: viewer.assuranceLevel,
    p_actor_issued_at: new Date(viewer.issuedAt * 1_000).toISOString(),
    p_payload: payload,
    p_payload_hash: sha256(input)
  });
  if (error) throw new Error(`SUPPORT_DATABASE_ERROR:${error.code ?? 'UNKNOWN'}`);
  return data as SupportCommandResult;
}
