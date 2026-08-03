import type { CommandEnvelope } from './contracts';
import type { AppRole } from '@/server/auth/roles';

type CommandPolicy = {
  humanOnly: boolean;
  roles: readonly AppRole[];
};

const policies: Readonly<Record<string, CommandPolicy>> = {
  'quotation.approve': { humanOnly: true, roles: ['manager', 'admin', 'founder'] },
  'customer_acceptance.validate': { humanOnly: true, roles: ['staff', 'manager', 'admin', 'founder'] },
  'payment_request.create': { humanOnly: true, roles: ['finance', 'admin', 'founder'] },
  'payment.evidence.submit': { humanOnly: true, roles: ['customer'] },
  'payment.detection.record': { humanOnly: true, roles: ['finance', 'admin', 'founder'] },
  'payment.review.start': { humanOnly: true, roles: ['finance', 'admin', 'founder'] },
  'payment.verify': { humanOnly: true, roles: ['finance', 'admin', 'founder'] },
  'funds.allocate': { humanOnly: true, roles: ['finance', 'founder'] },
  'payment.evaluate_readiness': { humanOnly: true, roles: ['finance', 'founder'] },
  'credit.approve': { humanOnly: true, roles: ['finance', 'founder'] },
  'booking.create': { humanOnly: true, roles: ['staff', 'manager', 'admin', 'founder'] },
  'supplier_booking.complete': { humanOnly: true, roles: ['staff', 'manager', 'admin', 'founder'] },
  'supplier_confirmation.capture': { humanOnly: true, roles: ['staff', 'manager', 'admin', 'founder'] },
  'booking.verification.start': { humanOnly: true, roles: ['manager', 'admin', 'founder'] },
  'booking.verify': { humanOnly: true, roles: ['manager', 'admin', 'founder'] },
  'supplier_confirmation.correct': { humanOnly: true, roles: ['staff', 'manager', 'admin', 'founder'] },
  'voucher.draft.create': { humanOnly: true, roles: ['staff', 'manager', 'admin', 'founder'] },
  'voucher.issue': { humanOnly: true, roles: ['manager', 'admin', 'founder'] },
  'support.case.open': { humanOnly: true, roles: ['customer'] },
  'support.case.message': { humanOnly: true, roles: ['customer'] },
  'support.case.claim': { humanOnly: true, roles: ['staff', 'manager', 'admin', 'founder'] },
  'support.case.priority.set': { humanOnly: true, roles: ['manager', 'admin', 'founder'] },
  'support.case.escalate': { humanOnly: true, roles: ['staff', 'manager', 'admin', 'founder'] },
  'support.case.customer_update': { humanOnly: true, roles: ['staff', 'manager', 'admin', 'founder'] },
  'support.case.internal_note': { humanOnly: true, roles: ['staff', 'manager', 'admin', 'founder'] },
  'support.case.resolve': { humanOnly: true, roles: ['staff', 'manager', 'admin', 'founder'] },
  'support.case.close': { humanOnly: true, roles: ['staff', 'manager', 'admin', 'founder'] },
  'crm.task.create': { humanOnly: true, roles: ['staff', 'manager', 'finance', 'admin', 'founder'] },
  'crm.task.claim': { humanOnly: true, roles: ['staff', 'manager', 'finance', 'admin', 'founder'] },
  'crm.task.status.set': { humanOnly: true, roles: ['staff', 'manager', 'finance', 'admin', 'founder'] },
  'crm.task.reassign': { humanOnly: true, roles: ['manager', 'admin', 'founder'] },
  'crm.task.cancel': { humanOnly: true, roles: ['manager', 'admin', 'founder'] },
  'supplier.configuration.create': { humanOnly: true, roles: ['manager', 'admin', 'founder'] },
  'supplier.configuration.revise': { humanOnly: true, roles: ['manager', 'admin', 'founder'] },
  'refund.approve': { humanOnly: true, roles: ['finance', 'admin', 'founder'] },
  'refund.execute': { humanOnly: true, roles: ['finance', 'founder'] },
  'role.assign': { humanOnly: true, roles: ['founder'] },
  'approval_limit.change': { humanOnly: true, roles: ['founder'] }
};

export class AuthorityError extends Error {
  readonly code = 'AUTHORITY_DENIED';

  constructor(message: string) {
    super(message);
    this.name = 'AuthorityError';
  }
}

export function assertCommandAuthority(command: CommandEnvelope): void {
  const policy = policies[command.commandName];
  if (!policy) return;

  if (policy.humanOnly && command.actor.kind !== 'human') {
    throw new AuthorityError(`${command.commandName} requires an accountable human actor.`);
  }
  if (!policy.roles.some((role) => command.actor.roles.includes(role))) {
    throw new AuthorityError(`${command.commandName} is outside the actor's assigned Role.`);
  }
}

export const governedCommandNames = Object.freeze(Object.keys(policies));
