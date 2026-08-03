export const personalMemberships = [
  { code: 'smart', name: 'Smart', monthlyAzn: 19, annualAzn: 190 },
  { code: 'plus', name: 'Plus', monthlyAzn: 39, annualAzn: 390 },
  { code: 'premium', name: 'Premium', monthlyAzn: 69, annualAzn: 690 },
  { code: 'black', name: 'Black', monthlyAzn: 299, annualAzn: 2990 }
] as const;

export const corporateMemberships = [
  { code: 'starter', name: 'Starter', monthlyAzn: 149 },
  { code: 'standard', name: 'Standard', monthlyAzn: 299 },
  { code: 'professional', name: 'Professional', monthlyAzn: 599 },
  { code: 'enterprise', name: 'Enterprise', monthlyAzn: null }
] as const;
