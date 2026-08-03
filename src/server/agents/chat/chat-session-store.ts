import type { ChatSession } from './chat-session-contract';

/** Phase 4C — chat session store port. `findByTokenHash` is the ONLY lookup
 *  method — there is deliberately no "list sessions for contact" or
 *  "list all sessions" method available to request-handling code, so an
 *  anonymous session can never be browsed to by anything other than its own
 *  exact token hash. */
export interface ChatSessionStore {
  createSession(session: ChatSession): Promise<void>;
  findByTokenHash(sessionTokenHash: string): Promise<ChatSession | null>;
  touchSession(sessionId: string, lastSeenAt: string): Promise<void>;
  linkSessionToContact(sessionId: string, contactId: string): Promise<void>;
  countRecentMessages(conversationId: string, sinceIso: string): Promise<number>;
}

export class InMemoryChatSessionStore implements ChatSessionStore {
  private readonly sessions = new Map<string, ChatSession>(); // key: tokenHash
  private readonly messageTimestamps = new Map<string, string[]>(); // conversationId -> createdAt[]

  async createSession(session: ChatSession): Promise<void> {
    this.sessions.set(session.sessionTokenHash, session);
  }

  async findByTokenHash(sessionTokenHash: string): Promise<ChatSession | null> {
    return this.sessions.get(sessionTokenHash) ?? null;
  }

  async touchSession(sessionId: string, lastSeenAt: string): Promise<void> {
    for (const [hash, session] of this.sessions) {
      if (session.sessionId === sessionId) {
        this.sessions.set(hash, { ...session, lastSeenAt });
        return;
      }
    }
  }

  async linkSessionToContact(sessionId: string, contactId: string): Promise<void> {
    for (const [hash, session] of this.sessions) {
      if (session.sessionId === sessionId) {
        this.sessions.set(hash, { ...session, contactId, isAnonymous: false });
        return;
      }
    }
  }

  /** Test helper — records a message timestamp for rate-limit counting. */
  recordMessageTimestamp(conversationId: string, createdAt: string): void {
    const list = this.messageTimestamps.get(conversationId) ?? [];
    list.push(createdAt);
    this.messageTimestamps.set(conversationId, list);
  }

  async countRecentMessages(conversationId: string, sinceIso: string): Promise<number> {
    const list = this.messageTimestamps.get(conversationId) ?? [];
    return list.filter((t) => Date.parse(t) >= Date.parse(sinceIso)).length;
  }
}
