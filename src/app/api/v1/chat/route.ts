import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SupabaseConversationStore } from '@/server/agents/supabase-conversation-store';
import { SupabaseChatSessionStore } from '@/server/agents/chat/supabase-chat-session-store';
import { startChatSession, sendChatMessage, loadChatSessionConversation, type ChatContext } from '@/server/agents/chat/chat-session-service';
import { ChatSessionAuthorityError } from '@/server/agents/chat/chat-session-contract';
import { VOYARA_BUSINESS_ACCOUNT_ID } from '@/server/agents/business-account';

/**
 * Phase 4C — website chat API. Same same-origin + JSON-only transport
 * hardening as /api/v1/inbox and /api/v1/orchestration. The session token is
 * the ONLY credential this route ever accepts to identify "which
 * conversation" — never a conversationId or contactId supplied directly by
 * the client, so a visitor cannot simply pass a different id to reach
 * someone else's chat. No internal prompt, CRM data, secret, or supplier
 * credential is ever included in any response here — responses contain only
 * the session's own conversation id and message content the visitor
 * themselves is a party to.
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

function hashIp(request: NextRequest): string | null {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return ip ? createHash('sha256').update(ip).digest('hex') : null;
}

function buildContext(request: NextRequest, correlationId: string): ChatContext {
  return {
    conversationStore: new SupabaseConversationStore(),
    sessionStore: new SupabaseChatSessionStore(),
    accountId: VOYARA_BUSINESS_ACCOUNT_ID, // single-business context — must be a valid uuid (see business-account.ts)
    correlationId,
    now: () => new Date()
  };
}

const startSchema = z.object({ action: z.literal('start'), preferredLocale: z.enum(['az', 'ru', 'en']), consentGiven: z.boolean() }).strict();
const sendSchema = z.object({ action: z.literal('send'), sessionToken: z.string().min(32).max(128), body: z.string().min(1).max(2_000) }).strict();
const actionSchema = z.discriminatedUnion('action', [startSchema, sendSchema]);

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStore({ error: 'REQUEST_ORIGIN_DENIED' }, 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return noStore({ error: 'JSON_REQUIRED' }, 415);
  }

  let json: unknown;
  try {
    json = JSON.parse(await request.text());
  } catch {
    return noStore({ error: 'INVALID_JSON' }, 400);
  }
  const parsed = actionSchema.safeParse(json);
  if (!parsed.success) return noStore({ error: 'INVALID_REQUEST' }, 400);

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const ctx = buildContext(request, correlationId);

  try {
    if (parsed.data.action === 'start') {
      const result = await startChatSession(ctx, {
        preferredLocale: parsed.data.preferredLocale, consentGiven: parsed.data.consentGiven, ipHash: hashIp(request), correlationId
      });
      return noStore({ ok: true, sessionToken: result.sessionToken, conversationId: result.conversationId }, 200);
    }

    const result = await sendChatMessage(ctx, { sessionToken: parsed.data.sessionToken, body: parsed.data.body, correlationId });
    return noStore({ ok: true, messageId: result.messageId }, 200);
  } catch (error) {
    if (error instanceof ChatSessionAuthorityError) {
      const status = error.code === 'RATE_LIMITED' ? 429 : error.code === 'CONSENT_REQUIRED' ? 400 : error.code === 'SESSION_NOT_FOUND' || error.code === 'SESSION_EXPIRED' ? 401 : 400;
      return noStore({ error: error.code }, status);
    }
    return noStore({ error: 'CHAT_REQUEST_FAILED' }, 500);
  }
}

export async function GET(request: NextRequest) {
  const sessionToken = request.nextUrl.searchParams.get('sessionToken');
  if (!sessionToken) return noStore({ error: 'SESSION_TOKEN_REQUIRED' }, 400);

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const ctx = buildContext(request, correlationId);

  try {
    const { conversationId } = await loadChatSessionConversation(ctx, sessionToken);
    // Only this session's own conversation id and its own messages are ever
    // returned — never any other visitor's data, never internal prompts,
    // never CRM fields beyond what the visitor themselves sent.
    return noStore({ ok: true, conversationId }, 200);
  } catch (error) {
    if (error instanceof ChatSessionAuthorityError) {
      return noStore({ error: error.code }, 401);
    }
    return noStore({ error: 'CHAT_REQUEST_FAILED' }, 500);
  }
}
