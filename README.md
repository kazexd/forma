# Forma — Professional Photo MVP

A full-stack **Next.js App Router** application with React and TypeScript. Upload exactly **5 photos**, choose one of three styles, and generate **1 professional portrait** through OpenAI. Supabase manages Google sign-up/sign-in. The frontend and API run in a single Node.js process; there is no separate Express server or frontend proxy.

## Local setup

Requires Node.js **22.16 or later** and npm.

```powershell
npm install
# Only if you do not already have .env:
Copy-Item .env.example .env
```

Edit `.env` locally:

```dotenv
OPENAI_API_KEY=your-openai-key
OPENAI_IMAGE_MODEL=gpt-image-2
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

The two Supabase values are public project configuration (a legacy anon key also works). Never use a Supabase secret/service_role key here. The OpenAI API key is server-only and must never have a NEXT_PUBLIC_ prefix. Do not share secrets in chat or commit .env. The previous VITE_SUPABASE_* names have been replaced by NEXT_PUBLIC_SUPABASE_*; update any environment files outside this checkout yourself.

```powershell
npm run dev
```

Open http://localhost:5173 or http://127.0.0.1:5173. **Port 5173 is retained deliberately**, so existing Supabase redirect URLs keep working. There is no service on port 3001. Restart the server after environment changes. Changing public environment variables also requires rebuilding for production.

For a production build served locally, stop the dev server first:

```powershell
npm run build
npm start
```

## Supabase Free + Google setup

1. Create a project on the Free plan at https://supabase.com/dashboard. Copy its project URL and publishable key into the environment variables above. Authentication alone needs no migration. The paid-preview feature below DOES require the supplied SQL migration and private bucket. Free plan quotas and inactivity rules apply: https://supabase.com/pricing .
2. In Google Cloud / Google Auth Platform, configure the consent screen and create an OAuth client of type **Web application**. Add http://localhost:5173 to Authorized JavaScript origins. For Authorized redirect URIs, use the hosted Supabase callback shown in the Google provider settings, normally https://YOUR_PROJECT.supabase.co/auth/v1/callback . This differs from the frontend callback. If Google is in Testing mode, add your own Google account as a test user.
3. In Supabase **Authentication → Sign In / Providers → Google**, enable Google and enter its Client ID and Client Secret. Keep the Google Client Secret in the Supabase dashboard. Enable new user sign-ups and disable unused providers if you only want Google login.
4. In Supabase **Authentication → URL Configuration**, set Site URL to http://localhost:5173 and add both exact Redirect URLs:
   - http://localhost:5173/auth/callback
   - http://127.0.0.1:5173/auth/callback
5. Start the app and allow the sign-in popup. First login creates a Supabase Auth user; subsequent logins reuse it. A normal Chrome/Edge window may be needed if Google rejects an embedded browser.

Official setup: https://supabase.com/docs/guides/auth/social-login/auth-google and https://supabase.com/docs/guides/auth/redirect-urls . Key types: https://supabase.com/docs/guides/getting-started/api-keys .

## Account and photo flow

Visitors can upload and choose styles. Generation requires a Google account session plus explicit photo-transmission consent. A popup and PKCE preserve the original tab's selected File objects. The callback is a real Next.js page at /auth/callback; the Supabase browser SDK exchanges the code and synchronizes the session between tabs. Blocked, cancelled and failed popups can be retried without losing photos.

Supabase's SDK persists the login session in local storage and refreshes it automatically. Input photo selections remain in browser memory. Generated originals and previews are saved to private Supabase Storage. Start over clears photos but preserves login. Local sign-out clears the current page's selections/results; it does not delete the account or sign out every device. Portraits can be restored using their owned portrait URL. A per-user generation allowance and Stripe test purchase flow are included.

## API and image processing

- POST /api/generate is a Node.js Route Handler. It accepts an Authorization: Bearer <Supabase access token> header, exactly five multipart photos files, one style (formal, casual, natural), and consent=true. It returns { photos: [{ id, previewUrl, downloadFilename }] }, with one WATERMARKED JPEG preview data URL; the original is never included. Failures return { error }.
- GET /api/health returns { configured: boolean, authConfigured: boolean } without exposing credentials. API responses use Cache-Control: no-store.
- Server-side Supabase getUser(token) verification rejects missing, expired, invalid or anonymous identities before processing photos or calling OpenAI. Unconfigured or unavailable authentication fails closed. Requests with a different Origin or cross-site fetch metadata are rejected.
- A streaming multipart parser enforces five files, JPEG/PNG/WebP types, 10 MiB per file and a 51 MiB total request limit, including chunked requests without Content-Length. Duplicate/unknown fields and malformed bodies are rejected. Sharp fully decodes the images, rejects animated inputs and images over 40 megapixels, corrects orientation, removes metadata and fits each reference inside 1024 × 1024.
- All five references go to the OpenAI Images edit API with n=1, size=1024x1536, quality=medium and JPEG output. Fixed prompts preserve identity while changing professional clothing, setting and lighting. Actual similarity must be evaluated manually with authorized photos.
- One generation runs at a time **per Node process**. This is not a distributed quota or public-service rate limiter. SDK automatic retries are disabled. Generation can take minutes; timeout or disconnect does not guarantee that processing stopped or that no charge occurred. Check usage before retrying.

Input photos are not saved by Forma; they are sent to OpenAI when generation is requested. Generated originals and watermarked previews are now saved in private Supabase Storage, with ownership/payment metadata in Postgres. Photo bytes are not written to application logs. OpenAI's own data policies apply: https://developers.openai.com/api/docs/guides/your-data . No zero-retention claim is made. Downloads are saved only on request. API fees are paid by the configured OpenAI account.

## Validation and deployment notes

```powershell
npm test
npm run typecheck
npm run build
```

Tests cover UI state, authentication/popups, API errors, streaming upload limits, image validation and generation concurrency. Backend tests call standard Request/Response handlers with fake Supabase/OpenAI clients; no paid requests or real Google sign-in occurs. Live OAuth and generated image quality still need verification with your credentials.

The production app needs a Node.js Next.js server; static export is not supported because the API is dynamic. Route Handlers explicitly use the Node runtime for Sharp/stream processing. Hosting platforms may impose smaller upload limits and shorter execution limits than the app permits; the exported maxDuration is only a platform hint. Per-user attempt quotas are enforced atomically in Postgres; public deployment still needs additional abuse/rate controls. No deployment is included in this migration.

Illustrative style photos are local stock assets, not generated results or endorsements. Sources: public/photos/SOURCES.txt; license: https://unsplash.com/license .


## Watermarked previews + Stripe test purchases

### Required setup before generating

1. In Supabase SQL Editor, run supabase/migrations/20261030_paid_portraits.sql ONCE. It creates server-only portrait/payment records, historical daily attempt reservations, and a private forma-portraits bucket. RLS and grants deny browser access to records and objects, including originals. Do not add permissive client policies for this bucket or make it public.
2. Put your Supabase service_role key (or server secret key) in SUPABASE_SERVICE_ROLE_KEY in your local .env. It is used only by backend modules. Never prefix it with NEXT_PUBLIC_ or put it in the browser. The existing public Supabase URL/key remain unchanged.
3. Apply the purchase-reset migration described below. Generation allowance is fixed at 3 until the next verified purchase. Apply the personal-gallery migration below; paid and unpaid portraits no longer expire. Reservations occur after valid photo processing but before an OpenAI call, so unsuccessful upstream attempts also count. This conservative accounting avoids accidentally treating possibly billed attempts as free.
4. Restart npm run dev. Storage is checked BEFORE generation; missing schema, missing service key or a public bucket blocks generation before an OpenAI call. The live configuration was not provisioned automatically.

### Stripe sandbox/test setup

1. Create or open your Stripe test environment. Create a product for one watermark-free portrait with a fixed, one-time **US$1.00 USD** test price. Set its price_... ID in STRIPE_PRICE_ID. The UI displays this price and the backend rejects Stripe prices with any amount other than 100 cents or any currency other than usd. The shared price is defined in src/portrait-price.mjs.
2. Put a TEST secret key (sk_test_...) in STRIPE_SECRET_KEY. Live secret keys and live webhook events are rejected by this implementation. No Stripe publishable key is needed for hosted checkout.
3. Install the official Stripe CLI and sign in, then forward events while the Next.js app runs:

~~~sh
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded --forward-to http://localhost:5173/api/stripe/webhook
~~~

4. Copy that listener's whsec_... signing secret into STRIPE_WEBHOOK_SECRET, then restart Next.js. Keep the listener running for local test purchases. A CLI webhook secret is different from a dashboard endpoint's secret.
5. Generate a portrait, inspect its watermarked preview, then click Buy watermark-free original. Use Stripe's test card 4242 4242 4242 4242, a future expiry and any three-digit CVC. Do not enter real payment details for this test flow.
6. After checkout, the app restores the portrait from its ID and polls for verified payment confirmation for about 30 seconds; Refresh purchase status remains available. A checkout=success URL alone never unlocks a download. A signed webhook or an authenticated status refresh independently retrieves the saved Checkout Session from Stripe. Access is granted only for a paid test session matching the recorded owner, portrait, checkout key, amount, currency and session. Status refresh can recover purchases when local webhook forwarding is interrupted.

Official payment guidance: https://docs.stripe.com/checkout/fulfillment.md?ui=full-page . Storage privacy: https://supabase.com/docs/guides/storage/buckets/fundamentals .

### Storage, purchase and download behavior

The original stays in private Storage. Sharp produces a separate JPEG preview fitting 600 × 900, with repeated vector-letter FORMA PREVIEW marks rendered into its pixels. No CSS-only watermark or original signed URL is sent before payment. Preview/download endpoints validate the owner on every request. Purchased screens show the clean original; Download original fetches clean bytes through an authenticated, no-store attachment endpoint. The original was generated once; buying it does not regenerate it.

GET /api/portraits/:id returns the owner's watermarked preview before purchase and the watermark-free original after verified payment, along with payment status. POST /api/portraits/:id/checkout creates or reuses a server-priced, idempotent test Checkout Session. GET /api/portraits/:id/download returns 402 before purchase and original bytes only after payment. POST /api/stripe/webhook verifies the raw signature and handles duplicate deliveries safely. No endpoint lets the browser set paid=true.

Both paid and unpaid portraits remain saved privately until their owner explicitly deletes them. There is no expiry-based deletion. Monitor Supabase storage and egress as collections grow.

The cleanup command only resumes owner-confirmed deletions already marked `deleting`; it never selects portraits by age:

~~~sh
npm run cleanup:portraits
~~~

If a checkout reservation has no saved Stripe session ID, deletion is blocked for manual recovery. Locate its session using the portrait/checkout metadata in Stripe before clearing anything. Failed image uploads attempt compensating deletion; inspect storage for orphaned objects after infrastructure failures.

The new storage and checkout integration is tested with injected service clients and synthetic signed events. A real Supabase migration, Stripe test price, signing secret and full sandbox round trip must be completed before the feature is ready for end users. Refund/dispute handling and live payment activation are outside this test-only release. OpenAI costs occur before the customer decides to purchase, and watermark removal cannot be made impossible.

## Sharing a purchased portrait

After the server reports a portrait as paid, the result screen offers X, LinkedIn, Facebook and Other apps. Choosing one fetches the original JPEG through the same authenticated, payment-protected download endpoint. The file stays in page memory and is reused when switching destinations; it is not made public or uploaded to another service automatically.

On browsers/devices supporting Web Share file attachments, a separate Share photo button invokes the device share sheet directly from a fresh click. Choose the installed app yourself and complete the post there. Forma cannot force a particular target app, and opening/closing a share sheet is not proof that a social post was published. Cancellation leaves the file available for another attempt.

For desktop/unsupported browsers, Download photo saves the purchased JPEG. Open X opens its text composer; Open LinkedIn and Open Facebook open their feeds. Attach the downloaded photo manually. Those links do not auto-attach files or contain the private portrait URL, a storage URL, portrait ID or auth token. Copy caption copies only a short suggested caption, with manual-copy guidance if clipboard access fails. Other apps supports the same native file share or manual-download flow for messaging/social apps.

No social account connection, posting API permissions, new public photo endpoint, database migration or additional Stripe/OpenAI call is required for sharing. Actual share targets depend on the device; native sharing requires browser support and a secure context (local development on loopback is treated specially by browsers). Capability is checked using navigator.canShare({files}).

Web Share behavior reference: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share .


### Purchase-reset generation allowance

Stop the app (including generation, payment status polling, webhooks and cleanup workers) during this upgrade. Run `supabase/migrations/20261031_purchase_generation_allowance.sql` once after the original paid-portrait migration, deploy the matching code, then restart the app and webhook forwarding. Do not run old application instances against the new schema. Stripe retries webhook deliveries that fail during downtime.

Every account starts with 3 attempts under this new system, including existing accounts. Historical attempts and paid portraits are not replayed. There is no daily reset or configurable daily limit; remove the obsolete `DAILY_GENERATION_LIMIT` from your local environment. Each validated attempt consumes one slot immediately before OpenAI, even if generation, saving, timeout or cancellation subsequently fails. Input/authentication/configuration failures do not consume slots. A first verified purchase of each unpaid portrait resets the balance to 3 (not +3). Payment recording and the reset are atomic; repeated webhooks and refreshes cannot grant another reset. Concurrent payments and generations serialize on the same account row. Old daily usage records remain for history.

`GET /api/generation-allowance` requires the signed-in user's bearer token and returns `{remaining, limit: 3}` without caching. Exhausted generation requests return HTTP 429 with `code: "generation_allowance_exhausted"`. Existing portraits can still be purchased and paid originals downloaded. If all attempts fail or the user deletes every unpaid preview, the account remains at zero; there is no independent credit purchase or free refill feature. Refunds/disputes are outside this version.


## My Gallery and permanent storage

Visit `/gallery` or use **My Gallery** in the header. Sign-in is required. The gallery shows your own portraits only, newest first, 12 at a time with All / Unpaid / Purchased filters and Load more. Thumbnails are fetched with bearer authentication and held in temporary Blob URLs that are revoked on unmount. Unpaid thumbnails and details use the embedded watermarked preview; paid ones use the original. Open a card to purchase, refresh payment status, download or share a purchased original. Checkout returns to the existing result page, with a View my gallery link. Start over never deletes stored portraits.

**Upgrade:** stop old app instances, webhook handlers, and especially all old expiry cleanup jobs. Apply `supabase/migrations/20261031_personal_gallery.sql` once, after both earlier migrations. Deploy/restart the matching app and webhook forwarding. This makes `expires_at` nullable, clears existing expiry dates, and replaces checkout reservation expiry restrictions. Existing rows marked deleting by old expiry cleanup are restored to unpaid/paid if still present; images already physically deleted cannot be recovered. Remove the obsolete `UNPAID_RETENTION_DAYS` variable. Never run the old cleanup executable against the upgraded schema.

`GET /api/portraits?status=all|unpaid|purchased&cursor=...` returns sanitized metadata and an opaque next cursor, never storage paths. `GET /api/portraits/:id/thumbnail` returns a private resized JPEG (maximum 480 × 640). All list/detail/image responses are no-store. Storage remains private; there are no public image URLs.

`DELETE /api/portraits/:id` requires bearer authentication, same-origin verification, and `{confirm:true,paid:boolean}` matching the state shown in the confirmation. Both original and preview are permanently deleted. Purchased deletion warns users to download first; it does not refund payment or change generation allowance. An open unpaid Stripe session is expired first. Pending payments/unresolved reservations block deletion. A newly discovered paid session is fulfilled and requires a fresh purchased-image confirmation. Snapshot comparisons in Postgres prevent a concurrent checkout or payment from being overwritten. Storage failures leave a hidden `deleting` row for safe retry or the cleanup command. Repeated deletion of an already absent portrait succeeds without revealing other users' records.

For isolated database checks, start a disposable Postgres container with `POSTGRES_DB=forma_test`, then run `python scripts/test-allowance-db.py <container-name>`. The checks include allowance transactions and gallery migration/deletion races. This script creates test schemas and must never target an existing application database.
