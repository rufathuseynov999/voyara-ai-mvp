'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Phase 4C — trilingual website AI chat widget.
 *
 * Talks only to /api/v1/chat, and only ever presents the session token it
 * itself received from `action: 'start'` — it never accepts or constructs a
 * conversationId/contactId to send to the server, so a visitor's own browser
 * state can't be used to reach another visitor's data even if this code
 * were tampered with client-side (the server enforces the real boundary;
 * this is defense in depth, not the only protection).
 *
 * The session token lives only in this component's React state — never in
 * localStorage/cookies here, per the "never store browser storage in
 * artifacts" pattern this project already follows, and simplest to reason
 * about for an anonymous visitor: a page refresh starts a fresh session,
 * which is an acceptable, honest tradeoff for this phase (documented in the
 * final report) rather than adding persistence this component doesn't need
 * to be genuinely useful and testable.
 */

export type ChatLabels = {
  openLabel: string; title: string; consentNotice: string; consentAccept: string; placeholder: string; send: string;
  languageLabel: string; humanHandoff: string; rateLimited: string; sessionExpired: string; close: string; newMessage: string; sending: string;
};

type Locale = 'az' | 'ru' | 'en';
type ChatMessage = { messageId: string; direction: 'INBOUND' | 'OUTBOUND'; body: string; senderKind: string };

export function WebsiteChatWidget({ labels, initialLocale }: { labels: ChatLabels; initialLocale: Locale }) {
  const [open, setOpen] = useState(false);
  const [consented, setConsented] = useState(false);
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnread, setHasUnread] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const startSession = useCallback(async () => {
    setError(null);
    const response = await fetch('/api/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify({ action: 'start', preferredLocale: locale, consentGiven: true })
    });
    const body = await response.json();
    if (response.ok) {
      setSessionToken(body.sessionToken);
      setConsented(true);
    } else {
      setError(body.error ?? 'CHAT_REQUEST_FAILED');
    }
  }, [locale]);

  async function sendMessage() {
    if (!sessionToken || !draft.trim() || sending) return;
    setSending(true);
    setError(null);
    const body = draft;
    setDraft('');
    const optimistic: ChatMessage = { messageId: `pending-${crypto.randomUUID()}`, direction: 'INBOUND', body, senderKind: 'CONTACT' };
    setMessages((prev) => [...prev, optimistic]);

    const response = await fetch('/api/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-correlation-id': crypto.randomUUID() },
      body: JSON.stringify({ action: 'send', sessionToken, body })
    });
    const responseBody = await response.json();
    if (!response.ok) {
      if (responseBody.error === 'RATE_LIMITED') setError(labels.rateLimited);
      else if (responseBody.error === 'SESSION_EXPIRED' || responseBody.error === 'SESSION_NOT_FOUND') {
        setError(labels.sessionExpired);
        setSessionToken(null);
        setConsented(false);
      } else setError(responseBody.error ?? 'CHAT_REQUEST_FAILED');
    }
    setSending(false);
  }

  useEffect(() => {
    if (open) {
      setHasUnread(false);
      panelRef.current?.scrollTo({ top: panelRef.current.scrollHeight });
    }
  }, [open, messages]);

  return (
    <div className="website-chat-widget" role="complementary" aria-label={labels.title}>
      {!open && (
        <button className="chat-launcher" onClick={() => setOpen(true)} aria-label={labels.openLabel}>
          {labels.openLabel}
          {hasUnread && <span className="chat-unread-dot" aria-label={labels.newMessage} />}
        </button>
      )}

      {open && (
        <section className="chat-panel" role="dialog" aria-modal="false" aria-label={labels.title}>
          <header className="chat-panel-header">
            <strong>{labels.title}</strong>
            <div className="chat-header-controls">
              <select aria-label={labels.languageLabel} value={locale} onChange={(e) => setLocale(e.target.value as Locale)} disabled={consented}>
                <option value="az">AZ</option>
                <option value="ru">RU</option>
                <option value="en">EN</option>
              </select>
              <button className="chat-close-btn" onClick={() => setOpen(false)} aria-label={labels.close}>✕</button>
            </div>
          </header>

          {!consented ? (
            <div className="chat-consent">
              <p>{labels.consentNotice}</p>
              <button className="button button-primary" onClick={startSession}>{labels.consentAccept}</button>
            </div>
          ) : (
            <>
              <div className="chat-messages" ref={panelRef} aria-live="polite">
                {messages.map((m) => (
                  <div key={m.messageId} className={`chat-bubble chat-bubble-${m.direction.toLowerCase()}`}>
                    {m.body}
                  </div>
                ))}
                {sending && <div className="chat-typing-indicator" aria-label={labels.sending}>{labels.sending}</div>}
              </div>

              {error && <p className="chat-error" role="alert">{error}</p>}

              <form
                className="chat-input-row"
                onSubmit={(e) => { e.preventDefault(); void sendMessage(); }}
              >
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={labels.placeholder}
                  aria-label={labels.placeholder}
                  disabled={sending}
                />
                <button type="submit" className="button button-primary" disabled={sending || !draft.trim()}>{labels.send}</button>
              </form>
            </>
          )}
        </section>
      )}
    </div>
  );
}
