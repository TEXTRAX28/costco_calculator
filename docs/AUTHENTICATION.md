# Gather accounts

Gather can be used as a guest. The browser keeps the current draft. Signing in opens a private library for saved receipts and split groups. The library receives a copy only when the user chooses to save it. OpenAI scanning continues to use the existing upload, consent and attempt limits.

## Architecture and provider choice

- The React account pages use a same-origin JSON API. The browser keeps a Secure, HttpOnly, SameSite=Lax cookie. Auth credentials and OAuth tokens stay out of browser storage.
- The account service uses an app-owned user UUID and session. The Firebase REST adapter handles email/password credentials and manages expiring verification and reset links through Firebase. Firebase Admin verifies ID tokens and uses the project directory to resolve a valid recovery link to its subject. The optional Google adapter uses `openid-client` for authorization-code exchange, PKCE S256, nonce, issuer, audience, expiry and signature checks.
- PostgreSQL stores external identity bindings by issuer and subject, local sessions, temporary OAuth transactions, shared rate counters and account-owned saved documents. New external identities get new Gather UUIDs, even when two verified email addresses match. Receipts and groups use the UUID obtained from the session. The library is the saved-entry history. Scans return synchronously to the initiating request and expose no stored job for users to retrieve.
- Firebase fits the current project because its Authentication service already has web configuration and can deliver verification and recovery email. The no-cost Spark plan has documented email and usage quotas. PostgreSQL can run on infrastructure you already have. Export of Firebase users is supported, and password-hash portability depends on the destination. Google uses a separate web OAuth client. [Firebase REST API](https://firebase.google.com/docs/reference/rest/auth) · [Firebase limits](https://firebase.google.com/docs/auth/limits) · [Firebase user export](https://firebase.google.com/docs/cli/auth) · [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)

## Set up a private test

1. Use Node 22.13 or later and one PostgreSQL database for the account-enabled instances. Use a dedicated database and role. Run schema changes with a role that can create tables and indexes. Give the runtime role only the CRUD access it needs to the account tables and read access to `gather_schema_version`. Use an authenticated connection. The app requires certificate-verified TLS for a non-loopback database. Use `GATHER_AUTH_DATABASE_CA_FILE` for a custom CA. [PostgreSQL privileges](https://www.postgresql.org/docs/current/ddl-priv.html)
2. In the Firebase project, enable Email/Password Authentication. Set the password policy to 15–128 characters without required character classes. Enable email enumeration protection if available in the project. Set up a dedicated service account with permission to read Auth users (`firebaseauth.users.get`). Store its JSON outside the Git worktree and web root. The server uses it for verified token and recovery lookups. Use the project's web API key and project ID. [Firebase password authentication](https://firebase.google.com/docs/auth/web/password-auth) · [Firebase Admin setup](https://firebase.google.com/docs/admin/setup) · [Firebase Auth IAM permissions](https://firebase.google.com/docs/projects/iam/permissions)
3. In Firebase Authentication's template settings, use the canonical HTTPS origin plus `/auth/action` as the custom email action URL. Authorize the exact host in Firebase and test the email templates on a dedicated test account. The provider delivers email. Gather does not require an SMTP credential. [Firebase custom email action handler](https://firebase.google.com/docs/auth/custom-email-handler)
4. Put the auth settings in this checkout's ignored `.env.local` beside the existing scan settings. For a service, put them in its secret-backed environment. Use `.env.example` for variable names. Set the exact browser origin without a trailing slash. On production or a phone, serve HTTPS. For a desktop-only loopback development test, `http://localhost:4175` can be used with a browser that accepts Secure cookies on localhost. Run the local app with that exact address, and keep production disabled for this test. Prefer a separate test Firebase project and verify its test domain settings. The shipped server rejects the Firebase emulator flag.
5. Generate a server-only rate key locally with Node and put the result in `GATHER_AUTH_RATE_KEY`. Configure the same key, session settings and database on each instance. For a private account test, set `GATHER_BETA_ALLOWED_EMAIL` to the permitted account address. The setting gates admission using the verified address. Ownership still follows the provider's issuer and subject.
6. Set `GATHER_AUTH_TRUST_PROXY=1` for the HTTPS reverse proxy. Use the updated Caddy template or implement its restrictions. Bind Node to loopback, keep its port private, overwrite `X-Gather-Client-IP` from the proxy's verified client connection, preserve the browser `Origin` on account routes, and forward account cookies only where needed. Keep access logs off and filter request URLs and headers from proxy runtime logs. Do not log request bodies or forward sensitive headers to monitoring. Keep the existing beta gateway in place until the public access policy is decided. [Caddy logging](https://caddyserver.com/docs/logging)
7. Set `GATHER_AUTH_ENABLED=1` after configuration. Run the following locally, or as the release procedure on an authorized host.

```powershell
npm ci
npm run auth:db -- migrate
npm run build
npm start
```

Use `node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"` in your own terminal to create the rate key. Treat the printed value as a secret. When configured, `GATHER_AUTH_PASSWORD_BLOCKLIST_FILE` is an absolute path to a local UTF-8 file of known compromised passwords, one exact value per line. Supply a trusted list and refresh it during operations. There is no remote password-check service configured.

### Optional Google sign-in

Create a Google OAuth **Web application** client for the chosen test domain. Register the exact callback `<GATHER_AUTH_ORIGIN>/api/auth/google/callback` and configure the consent screen/test users. Fill both `GOOGLE_OIDC_CLIENT_ID` and `GOOGLE_OIDC_CLIENT_SECRET`. The button appears only for a supported origin with both settings. A private LAN IP is suitable for a local app check and is excluded from the Google web OAuth callback configuration. The current build supports a separate Google identity even if its verified email matches a Firebase password account. [Google redirect rules](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation)

### Session and data operations

- Sessions expire after 30 minutes without account-library activity or seven days from sign-in, whichever comes first. The settings allow bounded local overrides. The sign-in endpoint rotates the token. Sign-out revokes it in the database. Signing out on all devices requires sign-in within the last ten minutes. Verification and password-reset links are single-use and Firebase controls their expiry. Password reset fences concurrent sign-ins and revokes existing Gather sessions for the mapped account.
- To respond to a compromised account, first disable the affected provider identity or revoke its provider sign-in access. Then run `npm run auth:db -- revoke <Gather user UUID>` using the account DB configuration. Restore provider access only after the owner recovers the credential. Run `npm run auth:db -- prune` periodically to remove expired sessions, consumed or expired OAuth attempts and elapsed rate counters.
- Rate limits use atomic PostgreSQL buckets shared by instances. Sign-in uses normalized email and IP, with IPv6 bucketed by /64. Registration, resend and reset requests share email and IP budgets. Applying valid verification and reset links also uses account-level budgets. App throttles are temporary. A bounded common response floor reduces normal-path timing differences for account discovery. Network variance and upstream-specific failure modes can still vary.
- Saved receipts contain the structured receipt and split. Saved groups contain a name and participant names. The account library can remove each entry. Opening a saved receipt places an editable copy in this browser's working draft. Clear local data also removes that local copy. Set the production retention and deletion process, backup expiry, and operator contact before admitting testers. The existing beta privacy and terms notices describe guest, account and scan data flows. The operator name, provider/host settings and retention decisions still need to be confirmed for hosted use.

## Verification

Run the existing regression suite plus account integration and provider contracts.

```powershell
npm run format:check
npm run typecheck
npm test -- --configLoader native --maxWorkers 1
npm run build
npm run test:e2e
npx playwright install webkit
npm run test:e2e:auth
```

The account browser test server uses synthetic users, an in-memory PostgreSQL test database and an ephemeral localhost HTTPS certificate. It is a separate test entry point. The production server has no switch to start it. Use `GATHER_TEST_CHROME=1` with installed Chrome if the packaged Chromium build is unavailable. The account browser suite also has a mobile WebKit project.

To test the actual Firebase adapter against the official local Auth emulator, run the following with a current Firebase CLI and the demo project identifier. The CLI may print synthetic action links. Keep real credentials and inboxes out of the emulator test.

```powershell
npx --yes --package firebase-tools -- firebase emulators:exec --only auth --project demo-gather-auth --config tests/fixtures/firebase-emulator.json "node --test tests/auth/firebase-emulator.test.mjs"
```

Before hosting, validate the real Caddy configuration in its intended environment. On a physical iPhone, check Safari autofill and password reveal, email links opened from Mail, and a cancelled Google prompt if configured. Confirm opening a saved copy, guest draft preservation, sign-out on both devices and the correct operator information. Keep scan allowance at zero in the authentication test environment unless separately authorized to scan.

See [Account migration and rollback](AUTH_MIGRATION.md).
