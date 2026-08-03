import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { Viewer } from '@/server/auth/viewer';
import { sha256 } from '@/server/bos/canonical-json';
import {
  buildCanonicalFundsAllocationPayload,
  buildCanonicalPaymentEvidencePayload,
  buildCanonicalPaymentVerificationPayload,
  buildCanonicalReadinessInputPayload,
  type PaymentCommand,
  type PaymentCommandResult
} from './contract';

type PaymentRequestRow = {
  id: string;
  amount_minor: number;
  currency: 'AZN';
  current_verification_id: string | null;
  current_verification_hash: string | null;
};

export async function executePaymentCommand(
  viewer: Viewer,
  input: PaymentCommand,
  idempotencyKey: string
): Promise<PaymentCommandResult> {
  const admin = createAdminSupabaseClient();
  if (!admin) throw new Error('PAYMENT_CONFIGURATION_UNAVAILABLE');

  let payload: Record<string, unknown>;
  if (input.action === 'payment_request.create') {
    payload = {
      quotationId: input.quotationId,
      versionNumber: input.versionNumber,
      quotationHash: input.quotationHash
    };
  } else if (input.action === 'payment.evidence.submit' || input.action === 'payment.detection.record') {
    const evidencePayload = buildCanonicalPaymentEvidencePayload(
      input.paymentRequestId,
      input.action === 'payment.evidence.submit' ? 'CUSTOMER_EVIDENCE' : 'FINANCE_DETECTION',
      input.channel,
      input.evidence
    );
    payload = {
      paymentRequestId: input.paymentRequestId,
      evidencePayload,
      evidenceHash: sha256(evidencePayload)
    };
  } else if (input.action === 'payment.review.start') {
    payload = {
      paymentRequestId: input.paymentRequestId,
      evidenceId: input.evidenceId,
      evidenceHash: input.evidenceHash
    };
  } else if (input.action === 'payment.verify') {
    const verificationPayload = buildCanonicalPaymentVerificationPayload(input);
    payload = {
      paymentRequestId: input.paymentRequestId,
      evidenceId: input.evidenceId,
      evidenceHash: input.evidenceHash,
      verificationPayload,
      verificationHash: sha256(verificationPayload)
    };
  } else if (input.action === 'funds.allocate') {
    const { data, error } = await admin
      .from('payment_requests')
      .select('id, amount_minor, currency, current_verification_id, current_verification_hash')
      .eq('id', input.paymentRequestId)
      .maybeSingle();
    if (error || !data) throw new Error('PAYMENT_REQUEST_NOT_FOUND');
    const payment = data as PaymentRequestRow;
    if (
      payment.currency !== 'AZN'
      || payment.current_verification_id !== input.verificationId
      || payment.current_verification_hash !== input.verificationHash
    ) {
      throw new Error('VERIFICATION_REFERENCE_MISMATCH');
    }
    const allocationPayload = buildCanonicalFundsAllocationPayload({
      paymentRequestId: payment.id,
      verificationId: input.verificationId,
      verificationHash: input.verificationHash,
      amountMinor: payment.amount_minor
    });
    payload = {
      paymentRequestId: input.paymentRequestId,
      verificationId: input.verificationId,
      verificationHash: input.verificationHash,
      allocationPayload,
      allocationHash: sha256(allocationPayload)
    };
  } else {
    const readinessInput = buildCanonicalReadinessInputPayload(input);
    payload = {
      paymentRequestId: input.paymentRequestId,
      allocationId: input.allocationId,
      allocationHash: input.allocationHash,
      readinessInput,
      readinessHash: sha256(readinessInput)
    };
  }

  const { data, error } = await admin.rpc('execute_payment_command', {
    p_command_id: randomUUID(),
    p_idempotency_key: idempotencyKey,
    p_command_name: input.action,
    p_actor_id: viewer.id,
    p_actor_session_id: viewer.sessionId,
    p_actor_aal: viewer.assuranceLevel,
    p_actor_issued_at: new Date(viewer.issuedAt * 1_000).toISOString(),
    p_payload: payload,
    p_payload_hash: sha256(payload)
  });

  if (error) throw new Error(`PAYMENT_DATABASE_ERROR:${error.code ?? 'UNKNOWN'}`);
  return data as PaymentCommandResult;
}
