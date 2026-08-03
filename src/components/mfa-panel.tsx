'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

type MfaMessages = {
  loading: string;
  enrollTitle: string;
  enrollBody: string;
  startEnrollment: string;
  scanCode: string;
  manualSecret: string;
  codeLabel: string;
  verify: string;
  verifying: string;
  challengeTitle: string;
  challengeBody: string;
  complete: string;
  continue: string;
  genericError: string;
};

type Enrollment = { factorId: string; qrCode: string; secret: string };

export function MfaPanel({ messages, nextPath }: { messages: MfaMessages; nextPath: string }) {
  const [phase, setPhase] = useState<'loading' | 'enroll' | 'challenge' | 'complete' | 'error'>('loading');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const supabase = createBrowserSupabaseClient();

    void Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    ]).then(([factorsResult, assuranceResult]) => {
      if (!active) return;
      if (factorsResult.error || assuranceResult.error) {
        setPhase('error');
        return;
      }
      if (assuranceResult.data.currentLevel === 'aal2') {
        setPhase('complete');
        return;
      }
      const verified = factorsResult.data.totp.find((factor) => factor.status === 'verified');
      if (verified) {
        setFactorId(verified.id);
        setPhase('challenge');
      } else {
        setPhase('enroll');
      }
    });

    return () => {
      active = false;
    };
  }, []);

  async function startEnrollment() {
    setBusy(true);
    const supabase = createBrowserSupabaseClient();
    const factors = await supabase.auth.mfa.listFactors();
    if (!factors.error) {
      await Promise.all(
        factors.data.all
          .filter((factor) => factor.factor_type === 'totp' && factor.status === 'unverified')
          .map((factor) => supabase.auth.mfa.unenroll({ factorId: factor.id }))
      );
    }

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'VOYARA AI',
      issuer: 'VOYARA AI'
    });
    setBusy(false);
    if (error) {
      setPhase('error');
      return;
    }

    const qrCode = data.totp.qr_code.startsWith('data:image/svg+xml')
      ? data.totp.qr_code
      : `data:image/svg+xml;utf-8,${encodeURIComponent(data.totp.qr_code)}`;
    setFactorId(data.id);
    setEnrollment({ factorId: data.id, qrCode, secret: data.totp.secret });
  }

  async function verifyCode(formData: FormData) {
    const code = String(formData.get('code') ?? '').replace(/\s/g, '');
    const selectedFactor = enrollment?.factorId ?? factorId;
    if (!selectedFactor || !/^\d{6,8}$/.test(code)) {
      setPhase('error');
      return;
    }

    setBusy(true);
    const supabase = createBrowserSupabaseClient();
    const challenge = await supabase.auth.mfa.challenge({ factorId: selectedFactor });
    if (challenge.error) {
      setBusy(false);
      setPhase('error');
      return;
    }
    const verification = await supabase.auth.mfa.verify({
      factorId: selectedFactor,
      challengeId: challenge.data.id,
      code
    });
    setBusy(false);
    if (verification.error) {
      setPhase('error');
      return;
    }
    setPhase('complete');
  }

  if (phase === 'loading') return <p aria-live="polite">{messages.loading}</p>;
  if (phase === 'complete') {
    return (
      <div className="auth-flow">
        <p className="form-status">{messages.complete}</p>
        <button className="button button-primary" onClick={() => window.location.replace(nextPath)} type="button">
          {messages.continue}
        </button>
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div className="auth-flow">
        <p aria-live="assertive" className="form-status form-status-error">{messages.genericError}</p>
        <button className="button button-primary" onClick={() => window.location.reload()} type="button">
          {messages.continue}
        </button>
      </div>
    );
  }

  return (
    <div className="auth-flow">
      <h2>{phase === 'challenge' ? messages.challengeTitle : messages.enrollTitle}</h2>
      <p>{phase === 'challenge' ? messages.challengeBody : messages.enrollBody}</p>
      {phase === 'enroll' && !enrollment ? (
        <button className="button button-primary" disabled={busy} onClick={startEnrollment} type="button">
          {messages.startEnrollment}
        </button>
      ) : null}
      {enrollment ? (
        <div className="mfa-enrollment">
          <img alt={messages.scanCode} height="220" src={enrollment.qrCode} width="220" />
          <p>{messages.scanCode}</p>
          <label htmlFor="mfa-secret">{messages.manualSecret}</label>
          <input id="mfa-secret" readOnly type="text" value={enrollment.secret} />
        </div>
      ) : null}
      {phase === 'challenge' || enrollment ? (
        <form action={verifyCode} className="auth-form">
          <label htmlFor="mfa-code">{messages.codeLabel}</label>
          <input
            autoComplete="one-time-code"
            id="mfa-code"
            inputMode="numeric"
            maxLength={8}
            minLength={6}
            name="code"
            pattern="[0-9]{6,8}"
            required
            type="text"
          />
          <button className="button button-primary" disabled={busy} type="submit">
            {busy ? messages.verifying : messages.verify}
          </button>
        </form>
      ) : null}
    </div>
  );
}
