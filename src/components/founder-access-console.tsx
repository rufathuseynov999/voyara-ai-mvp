'use client';

import { useState, type FormEvent } from 'react';
import type { Locale } from '@/i18n/config';
import { appRoles } from '@/server/auth/roles';

type FounderAccessMessages = {
  inviteTitle: string;
  inviteBody: string;
  email: string;
  role: string;
  invite: string;
  roleTitle: string;
  roleBody: string;
  userId: string;
  reason: string;
  assign: string;
  revoke: string;
  working: string;
  accepted: string;
  failed: string;
};

export function FounderAccessConsole({ locale, messages }: { locale: Locale; messages: FounderAccessMessages }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    const form = new FormData(event.currentTarget);
    const action = String(form.get('action'));
    const body = action === 'staff.invite'
      ? { action, email: form.get('email'), role: form.get('role'), locale }
      : {
          action,
          userId: form.get('userId'),
          role: form.get('role'),
          reason: String(form.get('reason') ?? '').trim() || undefined
        };

    try {
      const response = await fetch('/api/v1/founder/access', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID()
        },
        body: JSON.stringify(body)
      });
      setStatus(response.ok ? messages.accepted : messages.failed);
      if (response.ok) event.currentTarget.reset();
    } catch {
      setStatus(messages.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="access-console">
      <section className="access-console-card">
        <h2>{messages.inviteTitle}</h2>
        <p>{messages.inviteBody}</p>
        <form className="auth-form" onSubmit={submit}>
          <input name="action" type="hidden" value="staff.invite" />
          <label htmlFor="invite-email">{messages.email}</label>
          <input autoComplete="off" id="invite-email" name="email" required type="email" />
          <label htmlFor="invite-role">{messages.role}</label>
          <select defaultValue="staff" id="invite-role" name="role">
            {['staff', 'manager', 'finance', 'admin'].map((role) => <option key={role}>{role}</option>)}
          </select>
          <button className="button button-primary" disabled={busy} type="submit">
            {busy ? messages.working : messages.invite}
          </button>
        </form>
      </section>

      <section className="access-console-card">
        <h2>{messages.roleTitle}</h2>
        <p>{messages.roleBody}</p>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="role-user-id">{messages.userId}</label>
          <input id="role-user-id" name="userId" pattern="[0-9a-fA-F-]{36}" required type="text" />
          <label htmlFor="role-name">{messages.role}</label>
          <select defaultValue="staff" id="role-name" name="role">
            {appRoles.map((role) => <option key={role}>{role}</option>)}
          </select>
          <label htmlFor="role-reason">{messages.reason}</label>
          <input id="role-reason" maxLength={240} minLength={3} name="reason" type="text" />
          <div className="form-actions">
            <button className="button button-primary" disabled={busy} name="action" type="submit" value="role.assign">
              {busy ? messages.working : messages.assign}
            </button>
            <button className="button button-danger" disabled={busy} name="action" type="submit" value="role.revoke">
              {messages.revoke}
            </button>
          </div>
        </form>
      </section>
      <p aria-live="polite" className="form-status">{status}</p>
    </div>
  );
}
