import { randomUUID } from 'node:crypto';
import type { Viewer } from '@/server/auth/viewer';
import { staffAreaRoles } from '@/server/auth/roles';
import { executeBookingCommand } from '@/server/booking/command';
import type { StaffBookingCommand, BookingCommandResult } from '@/server/booking/contract';
import { AutomationAuthorityError } from './automation-contract';

/**
 * Phase 4G — BookingCommandPort.
 *
 * `executeBookingCommand` (src/server/booking/command.ts) was inspected in
 * full: it is a real, staff-authority command with three discriminated
 * actions (booking.create, supplier_booking.complete,
 * supplier_confirmation.capture), each requiring specific payment-request/
 * readiness-evaluation/execution identifiers and content hashes tied to
 * the real Phase 3C payment/booking readiness chain — it is not a generic
 * "confirm this booking" call with arbitrary fixture data. It forwards
 * `viewer.assuranceLevel` to a database stored procedure
 * (`p_actor_aal`) — the authoritative AAL2 enforcement happens inside that
 * real Postgres function, not in this TypeScript layer.
 *
 * `Viewer` (src/server/auth/viewer.ts) is inherently a human-session
 * concept — it only comes from a real authenticated Supabase session or
 * demo-role read, carrying a `sessionId` and `issuedAt`. There is no
 * "AI/system" Viewer shape to construct; an automation caller cannot
 * legitimately produce one. This port's own contract layer adds an
 * explicit, defense-in-depth check on top of that structural fact: even
 * if a caller somehow constructed a Viewer-shaped object, this port
 * refuses it unless it carries a real staff-area role and AAL2.
 *
 * Portal-task confirmation (`confirmTask`, Phase 4E) and this booking
 * command are, and remain, two distinct authoritative events — this port
 * does not call or depend on `confirmTask`, and nothing in
 * `production-journey-ports.ts`'s booking-command usage substitutes one
 * for the other.
 */

export interface BookingCommandPort {
  executeBookingCommand(viewer: Viewer, command: StaffBookingCommand, idempotencyKey: string): Promise<BookingCommandResult>;
}

function requireHumanStaffAal2(viewer: Viewer): void {
  if (!viewer || !viewer.id || !viewer.sessionId) {
    throw new AutomationAuthorityError('A real, authenticated human Viewer session is required to execute a booking command.', 'MISSING_APPROVAL');
  }
  if (!viewer.roles.some((r) => staffAreaRoles.includes(r))) {
    throw new AutomationAuthorityError('The viewer does not hold a staff-area role — booking commands are human-staff-only.', 'MISSING_APPROVAL');
  }
  if (viewer.assuranceLevel !== 'aal2') {
    throw new AutomationAuthorityError('Booking commands require an AAL2 viewer session.', 'MISSING_APPROVAL');
  }
}

export class ProductionBookingCommandPort implements BookingCommandPort {
  async executeBookingCommand(viewer: Viewer, command: StaffBookingCommand, idempotencyKey: string): Promise<BookingCommandResult> {
    requireHumanStaffAal2(viewer);
    return executeBookingCommand(viewer, command, idempotencyKey);
  }
}

export class InMemoryBookingCommandPort implements BookingCommandPort {
  private readonly calls: Array<{ viewerId: string; action: string; idempotencyKey: string }> = [];
  private readonly resultsByIdempotencyKey = new Map<string, BookingCommandResult>();

  async executeBookingCommand(viewer: Viewer, command: StaffBookingCommand, idempotencyKey: string): Promise<BookingCommandResult> {
    requireHumanStaffAal2(viewer);

    const existing = this.resultsByIdempotencyKey.get(idempotencyKey);
    if (existing) return existing;

    this.calls.push({ viewerId: viewer.id, action: command.action, idempotencyKey });
    const result: BookingCommandResult = {
      status: 'accepted',
      bookingId: command.action === 'booking.create' ? randomUUID() : (command as { bookingId: string }).bookingId,
      commandName: command.action
    };
    this.resultsByIdempotencyKey.set(idempotencyKey, result);
    return result;
  }

  callsFor(viewerId: string) { return this.calls.filter((c) => c.viewerId === viewerId); }
  allCalls() { return this.calls; }
}
