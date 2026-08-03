export const appRoles = ['customer', 'staff', 'manager', 'finance', 'admin', 'founder'] as const;
export type AppRole = (typeof appRoles)[number];

export const customerAreaRoles: readonly AppRole[] = [...appRoles];
export const staffAreaRoles: readonly AppRole[] = ['staff', 'manager', 'finance', 'admin', 'founder'];

export function hasAnyRole(actualRoles: readonly AppRole[], requiredRoles: readonly AppRole[]): boolean {
  return requiredRoles.some((role) => actualRoles.includes(role));
}
