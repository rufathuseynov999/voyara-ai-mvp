import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import type { ChatSession } from './chat-session-contract';
import type { ChatSessionStore } from './chat-session-store';

export class SupabaseChatSessionStore implements ChatSessionStore {
  private admin() {
    const client = createAdminSupabaseClient();
    if (!client) throw new Error('CHAT_SESSION_STORE_UNAVAILABLE: Supabase admin client is not configured.');
    return client;
  }

  async createSession(session: ChatSession): Promise<void> {
    const { error } = await this.admin().from('chat_sessions').insert({
      id: session.sessionId,
      account_id: session.accountId,
      contact_id: session.contactId,
      conversation_id: session.conversationId,
      session_token_hash: session.sessionTokenHash,
      is_anonymous: session.isAnonymous,
      ip_hash: session.ipHash,
      preferred_locale: session.preferredLocale,
      consent_given_at: session.consentGivenAt,
      created_at: session.createdAt,
      expires_at: session.expiresAt,
      last_seen_at: session.lastSeenAt
    });
    if (error) throw new Error(`CHAT_SESSION_WRITE_FAILED:${error.code}`);
  }

  async findByTokenHash(sessionTokenHash: string): Promise<ChatSession | null> {
    const { data, error } = await this.admin().from('chat_sessions').select('*').eq('session_token_hash', sessionTokenHash).maybeSingle();
    if (error) throw new Error(`CHAT_SESSION_READ_FAILED:${error.code}`);
    if (!data) return null;
    return {
      sessionId: data.id,
      accountId: data.account_id,
      contactId: data.contact_id,
      conversationId: data.conversation_id,
      sessionTokenHash: data.session_token_hash,
      isAnonymous: data.is_anonymous,
      ipHash: data.ip_hash,
      preferredLocale: data.preferred_locale,
      consentGivenAt: data.consent_given_at,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      lastSeenAt: data.last_seen_at
    };
  }

  async touchSession(sessionId: string, lastSeenAt: string): Promise<void> {
    const { error } = await this.admin().from('chat_sessions').update({ last_seen_at: lastSeenAt }).eq('id', sessionId);
    if (error) throw new Error(`CHAT_SESSION_TOUCH_FAILED:${error.code}`);
  }

  async linkSessionToContact(sessionId: string, contactId: string): Promise<void> {
    const { error } = await this.admin().from('chat_sessions').update({ contact_id: contactId, is_anonymous: false }).eq('id', sessionId);
    if (error) throw new Error(`CHAT_SESSION_LINK_FAILED:${error.code}`);
  }

  async countRecentMessages(conversationId: string, sinceIso: string): Promise<number> {
    const { count, error } = await this.admin()
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('direction', 'INBOUND')
      .gte('created_at', sinceIso);
    if (error) throw new Error(`CHAT_RATE_LIMIT_QUERY_FAILED:${error.code}`);
    return count ?? 0;
  }
}
