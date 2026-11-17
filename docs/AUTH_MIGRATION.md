# Account migration and rollback

## Identity contract

Gather owns the UUID in `gather_users.id`. Saved receipts and groups carry this UUID as their owner. A provider binding is the exact verified issuer and subject stored in `gather_identities`. Google uses `https://accounts.google.com`. Firebase uses `https://securetoken.google.com/<project-id>`. Email is contact and admission data. Two equal addresses can belong to two different Gather users.

The provider adapter returns `issuer`, `subject`, verified `email` and the time of the verified sign-in. It exposes only the operations the app needs. An email adapter must handle sign-in, registration, resend, recover, verification and reset with consistent errors and provider-managed links. An OIDC adapter must verify signatures and exact issuer, subject, audience, expiry, nonce and browser-bound state, and support PKCE. Run the contract tests in `tests/auth.provider.test.ts` and the real-provider staging flow before routing any real users.

For migration, establish a trusted old-to-new subject mapping from the provider export/import or from explicit ownership verification. A provider import that preserves subjects still changes the binding when the issuer changes. Keep a restricted migration manifest of old and new issuer/subject pairs and their Gather UUID. Reject collisions, missing records, ambiguous subjects and a binding already owned by someone else. Add verified new bindings in a reviewed transaction without changing any Gather UUID or document owner.

Where a provider cannot supply an authoritative mapping, have the user prove control of both identities in one recent, authenticated, short-lived linking flow before assigning the new binding. A support workflow should also use independent ownership proof and record the operator decision. The current app does not offer public account linking. Equal email addresses alone do not qualify.

## Backup and restore

Use a maintenance role and separate access-controlled backup storage. Auth exports and database dumps contain personal information. Keep keys and PostgreSQL passwords in supported secret storage, and restrict and encrypt the exports. Keep the Firebase password-hash parameters separate from the export.

1. Back up before schema changes and provider cutover. Use a custom-format PostgreSQL dump including the schema-version, users, identity bindings and saved documents. Skip session, pending OAuth and temporary rate-counter data. Inventory the Firebase account export separately. The existing scan allowance ledger and any local drafts have their own lifecycles.
2. Restore into a separate PostgreSQL database. Confirm the schema version, user count, identity-map coverage and receipt/group ownership with synthetic probes before substituting any production database. Keep the destination private. Any application connections must target the isolated restore first.
3. After a restore, keep old sessions invalidated. Test both sign-in methods you intend to offer, broken and expired email links, known cross-account IDs, and the guest workflow. Resume operations only after these checks pass. Use the retention policy to expire backups and provider exports.

```text
pg_dump --format=custom --exclude-table-data=gather_sessions --exclude-table-data=gather_oauth_attempts --exclude-table-data=gather_auth_limits --file=<restricted-backup> --dbname=<database-service>
pg_restore --exit-on-error --no-owner --dbname=<isolated-restore-service> <restricted-backup>
```

Use the PostgreSQL client version for the database in use and a `PGSERVICE`/protected password configuration. [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html) · [PostgreSQL pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html)

## Passwords, factors and sessions

Firebase can export password hashes and salts for Firebase scrypt credentials with the appropriate permissions. Some imported users may lack an exportable hash. Verify that a destination supports Firebase's exact modified scrypt scheme and parameters before promising password preservation. Use a secure reset/enrolment flow if it does not. Perform imports with approved tooling and keep hash keys out of shell histories and logs. [Firebase export/import](https://firebase.google.com/docs/cli/auth) · [Firebase Admin import](https://firebase.google.com/docs/auth/admin/import-users)

Google federated users authenticate at Google; Gather holds no Google password, refresh token or portable MFA secret. Gather has no app-managed MFA or passkey enrollment. Check whether external MFA enrollment and any provider-bound WebAuthn credentials can transfer. Plan re-enrollment when the destination, relying-party domain or provider requires it. Explain required user actions before cutover. End Gather sessions and pending OAuth attempts at the boundary and require a fresh sign-in. Expire old verification and reset links according to provider behavior, and send users through the new provider's links.

## Cutover and rollback

- Rehearse with an isolated restore and a test provider project. Take an encrypted snapshot and lock down migration access. Verify callback URLs, email templates, rate key synchronization, privacy notice and the cutover notice for users.
- At cutover, pause account writes and new sign-ins across all instances. Export the last identity state, import provider records, apply verified binding changes, check ID ownership, invalidate Gather sessions and pending OAuth attempts, then run login, recovery and cross-account checks. Reopen the account surface only after checks pass.
- Keep the old provider configuration and pre-cutover backup available during the rollback window with limited access. To roll back, pause account writes and sign-ins, record new account documents created since cutover, reconcile them by Gather UUID, restore old provider routes/template configuration and use a fresh session boundary. Do not overwrite post-cutover saves blindly. Rehearse data reconciliation and verify a sample of receipt and group owners before reopening.
- The account feature can be disabled with `GATHER_AUTH_ENABLED=0` while a provider is unavailable. Guests can still access the receipt workspace. Plan service restart and access revocation together across all instances.
