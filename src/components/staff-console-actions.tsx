'use client';

import { useState, useTransition } from 'react';
import {
  takeoverConversationAction, releaseConversationAction,
  approveWorkflowStepAction, retryDeadLetterAction
} from '@/server/agents/automation/staff-console-actions';
import { getDictionary } from '@/i18n/dictionaries';
import type { Locale } from '@/i18n/config';

/**
 * Phase 4G — staff automation console client actions. Approve and Retry
 * are genuinely enabled, wired to the real, production-tested server
 * actions. Errors are shown as the safe message the server action itself
 * already produces (StaffConsoleActionError messages are written to be
 * human-readable, never raw stack traces or internal exception text) —
 * this component does not add any additional detail beyond what the
 * action already decided is safe to surface. All interface text is
 * strictly AZ/RU/EN via the shared dictionary, never mixed.
 */

export function StaffConsoleActions({ locale, conversationId }: { locale: string; conversationId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = getDictionary(locale as Locale).staffAutomation;

  return (
    <div className="staff-console-actions">
      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(async () => {
          setError(null);
          try { await takeoverConversationAction(locale, conversationId); } catch { setError(t.genericError); }
        })}
      >
        {t.takeover}
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(async () => {
          setError(null);
          try { await releaseConversationAction(locale, conversationId); } catch { setError(t.genericError); }
        })}
      >
        {t.release}
      </button>
      {error && <p className="orch-note" role="alert">{error}</p>}
    </div>
  );
}

type ActionOutcome = 'idle' | 'pending' | 'success' | 'error';

export function ApproveStepButton({ locale, stepId }: { locale: string; stepId: string }) {
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<ActionOutcome>('idle');
  const [error, setError] = useState<string | null>(null);
  const t = getDictionary(locale as Locale).staffAutomation;

  const disabled = isPending || outcome === 'pending' || outcome === 'success';

  return (
    <span className="staff-action-inline">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOutcome('pending');
          setError(null);
          startTransition(async () => {
            try {
              await approveWorkflowStepAction(locale, stepId);
              setOutcome('success');
            } catch {
              setOutcome('error');
              setError(t.genericError);
            }
          });
        }}
      >
        {outcome === 'pending' || isPending ? t.approving : outcome === 'success' ? t.approved : t.approve}
      </button>
      {outcome === 'error' && error && <span className="orch-note" role="alert">{error}</span>}
    </span>
  );
}

export function RetryDeadLetterButton({ locale, deadLetterId }: { locale: string; deadLetterId: string }) {
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<ActionOutcome>('idle');
  const [error, setError] = useState<string | null>(null);
  const t = getDictionary(locale as Locale).staffAutomation;

  const disabled = isPending || outcome === 'pending' || outcome === 'success';

  return (
    <span className="staff-action-inline">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOutcome('pending');
          setError(null);
          startTransition(async () => {
            try {
              await retryDeadLetterAction(locale, deadLetterId);
              setOutcome('success');
            } catch {
              setOutcome('error');
              setError(t.genericError);
            }
          });
        }}
      >
        {outcome === 'pending' || isPending ? t.retrying : outcome === 'success' ? t.retried : t.retry}
      </button>
      {outcome === 'error' && error && <span className="orch-note" role="alert">{error}</span>}
    </span>
  );
}
