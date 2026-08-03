'use client';

import { useState, type FormEvent } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

/**
 * Phase 3C — email/password authentication.
 *
 * Adds password sign-in and self-serve password sign-up alongside the
 * existing magic-link (OTP) flow from the Phase 3 baseline; the magic-link
 * path is unchanged. Both paths produce an ordinary Supabase session —
 * nothing downstream (getViewer(), RLS, role_assignments) differs by how the
 * session was created, so no server-side change was needed to support this.
 *
 * Staff/founder accounts remain invite-only (see staffInviteOnly copy and the
 * separate /activate-staff flow) — this form's password sign-up path is for
 * customer self-registration only. A new account is auto-granted the
 * 'customer' role by a database trigger on auth.users insert
 * (private.handle_new_auth_user(), task002 migration) and nothing more; it
 * never carries a staff-area role until a founder/admin explicitly grants
 * one, so self-registration can never reach a staff-only screen.
 */

type LoginMessages = {
  emailLabel: string;
  emailPlaceholder: string;
  sendLink: string;
  sending: string;
  linkSent: string;
  genericError: string;
  passwordTabLink: string;
  passwordTabPassword: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  passwordSignIn: string;
  passwordSigningIn: string;
  passwordCreateAccount: string;
  passwordCreatingAccount: string;
  passwordToggleToSignUp: string;
  passwordToggleToSignIn: string;
  passwordInvalidCredentials: string;
  passwordTooShort: string;
  passwordAccountCreated: string;
};

export function LoginForm({ messages, nextPath }: { messages: LoginMessages; nextPath: string }) {
  const [mode, setMode] = useState<'link' | 'password'>('link');
  const [passwordFlow, setPasswordFlow] = useState<'signIn' | 'signUp'>('signIn');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleLinkSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('sending');
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim().toLowerCase();

    try {
      const supabase = createBrowserSupabaseClient();
      const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo, shouldCreateUser: true }
      });
      setStatus(error ? 'error' : 'sent');
    } catch {
      setStatus('error');
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const password = String(form.get('password') ?? '');

    if (passwordFlow === 'signUp' && password.length < 8) {
      setStatus('error');
      setErrorMessage(messages.passwordTooShort);
      return;
    }

    setStatus('sending');
    setErrorMessage('');
    try {
      const supabase = createBrowserSupabaseClient();
      if (passwordFlow === 'signIn') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setStatus('error');
          setErrorMessage(messages.passwordInvalidCredentials);
          return;
        }
        window.location.assign(nextPath);
        return;
      }

      const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
      const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo } });
      if (error) {
        setStatus('error');
        setErrorMessage(messages.genericError);
        return;
      }
      setStatus('sent');
      setErrorMessage(messages.passwordAccountCreated);
    } catch {
      setStatus('error');
      setErrorMessage(messages.genericError);
    }
  }

  return (
    <div className="auth-form-group">
      <div className="auth-tabs" role="tablist">
        <button
          aria-selected={mode === 'link'}
          className={mode === 'link' ? 'auth-tab is-active' : 'auth-tab'}
          onClick={() => { setMode('link'); setStatus('idle'); }}
          role="tab"
          type="button"
        >
          {messages.passwordTabLink}
        </button>
        <button
          aria-selected={mode === 'password'}
          className={mode === 'password' ? 'auth-tab is-active' : 'auth-tab'}
          onClick={() => { setMode('password'); setStatus('idle'); }}
          role="tab"
          type="button"
        >
          {messages.passwordTabPassword}
        </button>
      </div>

      {mode === 'link' ? (
        <form className="auth-form" onSubmit={handleLinkSubmit}>
          <label htmlFor="email">{messages.emailLabel}</label>
          <input
            autoComplete="email"
            id="email"
            inputMode="email"
            name="email"
            placeholder={messages.emailPlaceholder}
            required
            type="email"
          />
          <button className="button button-primary" disabled={status === 'sending' || status === 'sent'} type="submit">
            {status === 'sending' ? messages.sending : messages.sendLink}
          </button>
          <p aria-live="polite" className={status === 'error' ? 'form-status form-status-error' : 'form-status'}>
            {status === 'sent' ? messages.linkSent : status === 'error' ? messages.genericError : ''}
          </p>
        </form>
      ) : (
        <form className="auth-form" onSubmit={handlePasswordSubmit}>
          <label htmlFor="password-email">{messages.emailLabel}</label>
          <input
            autoComplete="email"
            id="password-email"
            inputMode="email"
            name="email"
            placeholder={messages.emailPlaceholder}
            required
            type="email"
          />
          <label htmlFor="password">{messages.passwordLabel}</label>
          <input
            autoComplete={passwordFlow === 'signIn' ? 'current-password' : 'new-password'}
            id="password"
            minLength={passwordFlow === 'signUp' ? 8 : undefined}
            name="password"
            placeholder={messages.passwordPlaceholder}
            required
            type="password"
          />
          <button className="button button-primary" disabled={status === 'sending'} type="submit">
            {status === 'sending'
              ? (passwordFlow === 'signIn' ? messages.passwordSigningIn : messages.passwordCreatingAccount)
              : (passwordFlow === 'signIn' ? messages.passwordSignIn : messages.passwordCreateAccount)}
          </button>
          <button
            className="button button-quiet"
            onClick={() => { setPasswordFlow(passwordFlow === 'signIn' ? 'signUp' : 'signIn'); setStatus('idle'); setErrorMessage(''); }}
            type="button"
          >
            {passwordFlow === 'signIn' ? messages.passwordToggleToSignUp : messages.passwordToggleToSignIn}
          </button>
          <p aria-live="polite" className={status === 'error' ? 'form-status form-status-error' : 'form-status'}>
            {status === 'sent' ? errorMessage : status === 'error' ? (errorMessage || messages.genericError) : ''}
          </p>
        </form>
      )}
    </div>
  );
}
