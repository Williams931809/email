# Hamthel Mail Room

Private company email marketing workspace with independent email/password accounts, contacts, tags, CSV import/export, campaign drafts, templates, previews, sequence plans, backups and admin-managed team invitations.

Email delivery, scheduling and automatic sequence execution are not implemented yet. A Brevo API key has not been connected.

## Email template collection

The Hamthel Mail Room Templates screen includes 12 curated designs across six layouts: welcome, two newsletters, launch, promotion, event invitation, property showcase, thank-you, reconnect, seasonal, internal update, and milestone. Search or filter the collection and preview designs at desktop or mobile widths. Choose a template to start a draft; edit the accent color, small heading, main headline, message, and button destination in the campaign editor.

Design settings are stored with each draft and used by the HTML preview export. Existing drafts without design settings remain supported. Template text is sample copy to replace before use. The renderer escapes editable content and permits only HTTP/HTTPS button destinations. Previews use the sample recipient Alex. Email-client rendering has not been tested in Outlook/Gmail devices; live delivery is still unavailable.

## Deploy the website on Vercel

Import this repository into Vercel. Use Vite, build command `npm run build`, and output directory `dist`. The repository root is the application root. `vercel.json` configures the API proxy and routing.

Set these server-only production environment variables before deploying:

- `MAILROOM_BACKEND_URL`: `https://emxuvmpjamejoggjwaul.supabase.co/functions/v1/mailroom-v2`
- `MAILROOM_PROXY_KEY`: the existing private backend bridge key, supplied separately. Never commit this key or prefix it with `VITE_`.

Without these settings the API fails closed. The website uses the same existing backend and company accounts as the Android app. Do not reset the database or rerun first-owner setup.

After deployment, add `mailroom.hamthelholdings.com` to the project and use the exact DNS record Vercel supplies. Keep `mail.hamthelholdings.com` and all existing email MX/TXT records intact: that hostname is the company email server.

## Local development

Run `npm ci`, `npm run build`, and `npm test`. Run `npm run dev` for the frontend; the same-origin `/api` routes require a serverless development host with the server-only environment configured.

## Account security

The first owner is claimed atomically using a private setup code. Subsequent accounts require email-bound, single-use admin invitations. Passwords use PBKDF2-SHA256; sessions are checked by the backend. The web proxy uses an HttpOnly cookie. The existing backend already has its owner setup claimed.

Backend source is in `backend/`; isolated database objects use the `mr2_` prefix. These files are source references, not deployment migrations to run against the existing workspace. No privileged keys, owner setup codes, user data or Android signing files belong in this repository.

## Android

Native Android source is included in `android/`. Its bundled interface uses the separate `mailroom-mobile` backend and does not require Vercel or ChatGPT to run. See `android/build.sh` for SDK, Java, signing and backend environment requirements. Internet is required for shared data and authentication.
