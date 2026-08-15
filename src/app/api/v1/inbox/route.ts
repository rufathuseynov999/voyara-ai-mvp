import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getViewer } from '@/server/auth/viewer';
import { hasAnyRole, staffAreaRoles } from '@/server/auth/roles';
import { loadInboxConversationDetail, loadInboxConversations, loadVoiceCallForConversation, markConversationRead } from '@/server/agents/inbox-queries';
import { assignConversation, setHandoverStatus } from '@/server/agents/inbox-actions';
import { escalateConversation } from '@/server/agents/agent-operating-layer';
import { SupabaseConversationStore } from '@/server/agents/supabase-conversation-store';
import { SimulationChannelAdapter } from '@/server/agents/simulation-channel-adapter';
import { executeWhatsAppConversionCommand, whatsappConversionInputSchema } from '@/server/whatsapp/whatsapp-conversion-command';

/**
 * Phase 4B — CRM inbox API. Same transport hardening as
 * /api/v1/orchestration: same-origin, JSON-only, AAL2 staff required for
 * every action. GET is read-only; POST actions are all plain record-keeping
 * (assign/handover) or reuse the existing, tested escalation path — no
 * action here can approve, send, pay, book, or refund anything.
 */

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = request.headers.get('host');
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || request.nextUrl.protocol.replace(':', '');
  return host ? origin === `${protocol}://${host}` : false;
}

function noStore(body: object, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function requireAal2Staff() {
  const viewer = await getViewer();
  if (!viewer) return null;
  if (!hasAnyRole(viewer.roles, staffAreaRoles) || viewer.assuranceLevel !== 'aal2') return null;
  return viewer;
}

export async function GET(request: NextRequest) {
  const viewer = await requireAal2Staff();
  if (!viewer) return noStore({ error: 'STAFF_AAL2_REQUIRED' }, 403);

  const conversationId = request.nextUrl.searchParams.get('conversationId');
  if (conversationId) {
    const detail = await loadInboxConversationDetail(viewer, conversationId);
    if (!detail) return noStore({ error: 'NOT_FOUND' }, 404);
    await markConversationRead(conversationId, new Date().toISOString());
    const voiceCall = detail.channel === 'VOICE' ? await loadVoiceCallForConversation(conversationId) : null;
    return noStore({ ok: true, conversation: { ...detail, voiceCall } }, 200);
  }

  const filters = {
    brand: request.nextUrl.searchParams.get('brand') as 'RTRAVEL' | 'VOYARA' | undefined,
    channel: request.nextUrl.searchParams.get('channel') ?? undefined,
    language: request.nextUrl.searchParams.get('language') ?? undefined,
    status: request.nextUrl.searchParams.get('status') ?? undefined,
    assignedOwnerId: request.nextUrl.searchParams.get('assignedOwnerId') ?? undefined,
    callStatus: request.nextUrl.searchParams.get('callStatus') ?? undefined,
    transferred: request.nextUrl.searchParams.has('transferred') ? request.nextUrl.searchParams.get('transferred') === 'true' : undefined,
    callbackRequired: request.nextUrl.searchParams.has('callbackRequired') ? request.nextUrl.searchParams.get('callbackRequired') === 'true' : undefined,
    urgency: request.nextUrl.searchParams.get('urgency') ?? undefined
  };
  const conversations = await loadInboxConversations(viewer, filters);
  return noStore({ ok: true, conversations }, 200);
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), conversationId: z.uuid() }).strict(),
  z.object({ action: z.literal('handover'), conversationId: z.uuid(), status: z.enum(['AI', 'HUMAN']) }).strict(),
  z.object({ action: z.literal('escalate'), conversationId: z.uuid(), reasonCode: z.string().min(1).max(120) }).strict(),
  z.object({ action: z.literal('convertWhatsApp'), input: whatsappConversionInputSchema }).strict()
]);

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStore({ error: 'REQUEST_ORIGIN_DENIED' }, 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return noStore({ error: 'JSON_REQUIRED' }, 415);
  }
  const viewer = await requireAal2Staff();
  if (!viewer) return noStore({ error: 'STAFF_AAL2_REQUIRED' }, 403);

  let json: unknown;
  try {
    json = JSON.parse(await request.text());
  } catch {
    return noStore({ error: 'INVALID_JSON' }, 400);
  }
  const parsed = actionSchema.safeParse(json);
  if (!parsed.success) return noStore({ error: 'INVALID_ACTION' }, 400);
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();

  try {
    if (parsed.data.action === 'assign') {
      await assignConversation(parsed.data.conversationId, viewer.id, correlationId);
    } else if (parsed.data.action === 'handover') {
      await setHandoverStatus(parsed.data.conversationId, parsed.data.status, viewer.id, correlationId);
    } else if (parsed.data.action === 'convertWhatsApp') {
      // The wrapper itself re-derives actor/session/AAL from `viewer`
      // (already cryptographically verified above by requireAal2Staff)
      // — this route never passes anything from parsed.data as authority,
      // only the business-input fields the schema allows.
      const result = await executeWhatsAppConversionCommand(viewer, parsed.data.input);
      return noStore({ ok: true, conversion: result }, 200);
    } else {
      await escalateConversation(
        { store: new SupabaseConversationStore(), channel: new SimulationChannelAdapter(), actor: { id: viewer.id, kind: 'human' }, accountId: viewer.id, correlationId, now: () => new Date() },
        parsed.data.conversationId,
        parsed.data.reasonCode
      );
    }
    return noStore({ ok: true }, 200);
  } catch {
    return noStore({ error: 'ACTION_FAILED' }, 500);
  }
}
