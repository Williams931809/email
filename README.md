# Hamthel Mail Room 2.1

Private company email marketing with independent email/password accounts. The existing first owner and invitation-only team access remain in place.

## Available features

- Contacts, editable names/tags, subscription status, CSV import/export, and tag-based audiences.
- Campaign drafts, 12 designed templates, editable colors/headings/buttons, mobile/desktop preview and HTML export.
- Admin-only campaign sending, scheduling and test delivery to the signed-in admin’s own account.
- Durable delivery queue, UTC daily attempt limit of 300, concurrent-safe claims and request deduplication.
- Authenticated Brevo events, delivery reports, per-recipient statuses and CSV activity export.
- Unsubscribe links, one-click unsubscribe support, suppression of hard bounces/complaints/blocked addresses.
- Automatic sequences for new subscribers or added tags, manual enrollment, admin approval of active content, ordered steps and delays after provider acceptance. Existing contacts never receive an activation email without explicit admin enrollment.
- Installation as a web app in supported browsers. Internet is required; authenticated data and API responses are never cached by the service worker.
- Backups, team invitations, password changes, owner recovery and staff reset links.

## Finish provider setup

In the deployed app, an admin opens Settings, saves the company sender email and postal address, then enters a Brevo API key in the encrypted connection form. The key is encrypted server-side and never included in workspace backups or API responses. Connecting creates a dedicated authenticated Brevo event webhook; it does not send an email. Verify the sender in Brevo, check it in the app, then explicitly enable delivery. Use the test button on a saved campaign to queue one test to your own account before sending to subscribers.

The app does not purchase a plan or increase the daily limit beyond 300. Brevo’s account limits and policies also apply. The limit is shared across campaigns, tests and sequences. Daily reservations include failed attempts; remaining queued emails resume after capacity is available. Ambiguous provider results are marked uncertain and never automatically resent. An admin should review Brevo logs before deciding whether to queue a replacement. Opens/clicks are tracking signals, not reliable proof of reading.

## Architecture and existing deployment

The Vite frontend uses the same-origin `api/handler.ts` proxy on Vercel. It reads server-only production `MAILROOM_BACKEND_URL` and `MAILROOM_PROXY_KEY`; never prefix these with `VITE_` or commit values. The current backend is the existing `mailroom-v2` Edge Function. The native Android source uses `mailroom-mobile`. Both share the existing isolated `mr2_*` data and custom sessions.

`mailroom-delivery` is the public delivery entry point, with separate authenticated worker and webhook routes and opaque-token unsubscribe links. Its health endpoint contains no user data. A one-minute pg_cron/pg_net job calls its worker using a worker-only secret held in Supabase Vault. No service-role key is placed in a URL or cron command.

All delivery tables have RLS enabled and grants revoked from public/anon/authenticated. Delivery RPCs use SECURITY INVOKER and are executable only by service_role. Provider keys are AES-GCM encrypted with a key derived from the managed server secret. Rotating the Supabase service key requires reconnecting Brevo. Service credentials, provider keys, owner setup/recovery codes and Android signing files do not belong in this repository.

## Database and function sources

`backend/delivery.sql` describes the new delivery schema; `backend/install-worker.sql` installs the scheduler. These are already applied to the existing project: do not rerun the initial schema or recreate user data. See `backend/index.ts`, `backend/mobile.ts` and `backend/delivery-worker.ts` for the three deployed entry points and their relative dependencies. `tests/delivery-database.sql` verifies queue behavior inside a transaction and rolls back every fixture.

## Development and validation

Run `npm ci`, `npm run build`, and `npm test`. Backend delivery TypeScript can be checked with:

```
npx tsc --noEmit --strict --skipLibCheck --target ES2022 --lib ES2022,DOM --module ESNext --moduleResolution bundler --allowImportingTsExtensions backend/deno-types.d.ts backend/delivery.ts backend/delivery-core.ts backend/delivery-worker.ts
```

No real delivery was performed during implementation. Brevo sender acceptance and inbox delivery require the owner’s API key, verified sender, and an explicit test send. Android source is included; an existing installed APK must be rebuilt/signed to receive the latest bundled frontend. The web app receives updates through Vercel.

Keep `mailroom.hamthelholdings.com` for this website. Do not change `mail.hamthelholdings.com` or existing email MX/TXT records.
