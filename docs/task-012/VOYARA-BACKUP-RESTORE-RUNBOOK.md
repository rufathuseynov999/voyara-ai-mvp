# VOYARA AI — Backup and Restore Runbook

Backups contain Customer, commercial, Payment, Booking and Support information. They are sensitive even when card data is excluded.

## Backup

1. Use a restricted operator environment with matching PostgreSQL client tools.
2. Export `DATABASE_URL` only in the secret-bearing process environment.
3. Set `VOYARA_BACKUP_CONFIRM=BACKUP_CONTAINS_SENSITIVE_DATA`.
4. Run `npm run db:backup -- --execute`.
5. Verify exit status, file existence, restrictive file permission and a separately recorded SHA-256.
6. Encrypt before transfer or off-host retention. Never place dumps in Git, public Storage, email, chat or the application `public/` directory.
7. Record the managed Supabase backup state as separate evidence; an application logical dump does not replace the managed platform backup.

The repository does not invent RPO, RTO or retention duration. Rufat Huseynov must approve them using measured staging restore evidence and the selected Supabase plan.

## Restore rehearsal

The supplied restore script is destructive to its target and therefore refuses to run without all of these controls:

- `--execute`;
- `--backup=<approved dump>`;
- `VOYARA_RESTORE_TARGET=staging`;
- `VOYARA_RESTORE_CONFIRM=NON_PRODUCTION_ONLY`;
- `VOYARA_RESTORE_DATABASE_URL`;
- `VOYARA_PRODUCTION_DATABASE_HOST`, which must differ from the target.

Example operator sequence:

```bash
npm run db:restore:rehearsal
npm run db:restore:rehearsal -- --execute --backup=/secure/path/voyara-approved.dump
```

After restore:

1. verify all migration history records;
2. run `supabase db lint --level error`;
3. run `supabase test db`;
4. execute the complete authority journey with synthetic staging data;
5. verify Customer isolation and Founder AAL2;
6. record measured restore duration and failures;
7. destroy or sanitize the rehearsal environment according to the approved data-retention policy.

Never restore a dump into Production as an ad hoc rollback. Use a controlled recovery decision with Supabase support/managed restore evidence and accountable Founder authorization.
