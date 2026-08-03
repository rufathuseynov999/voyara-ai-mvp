import { z } from 'zod';
import { isLocale } from '@/i18n/config';
import { appRoles } from './roles';

const reasonSchema = z.string().trim().min(3).max(240).optional();

export const accessCommandInputSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('staff.invite'),
    email: z.email().max(254),
    role: z.enum(['staff', 'manager', 'finance', 'admin']),
    locale: z.string().refine(isLocale)
  }),
  z.object({
    action: z.literal('role.assign'),
    userId: z.uuid(),
    role: z.enum(appRoles),
    reason: reasonSchema
  }),
  z.object({
    action: z.literal('role.revoke'),
    userId: z.uuid(),
    role: z.enum(appRoles),
    reason: reasonSchema
  })
]);

export type AccessCommandInput = z.infer<typeof accessCommandInputSchema>;

export type AccessCommandResult = {
  status: 'accepted' | 'denied';
  reasonCode?: string;
  commandName?: string;
  invitationId?: string;
  userId?: string;
  role?: string;
  changed?: boolean;
};
