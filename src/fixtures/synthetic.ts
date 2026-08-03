import type { AppRole } from '@/server/auth/roles';

export type SyntheticPersona = {
  id: string;
  email: `${string}@voyara.example`;
  displayName: string;
  roles: readonly AppRole[];
  synthetic: true;
};

export const syntheticPersonas: readonly SyntheticPersona[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'customer@voyara.example',
    displayName: 'Səyyah Nümunə',
    roles: ['customer'],
    synthetic: true
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'founder@voyara.example',
    displayName: 'Təsisçi Nümunə',
    roles: ['founder'],
    synthetic: true
  }
] as const;
