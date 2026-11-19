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
- Upload/decode memory is bounded to one request per Node process; the generation-protection migration additionally enforces a shared single-flight lease and a site-wide daily cap in Postgres. SDK automatic retries are disabled. Generation can take minutes; timeout or disconnect does not guarantee that processing stopped or that no charge occurred. Check usage before retrying.

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


## First Render deployment (operations closed)

This prepares an online installation only. Public launch, abuse controls and Stripe Live activation remain separate release steps. Node 22 is selected by `.node-version` and the package engines range. `npm start` runs the built app on `0.0.0.0` and Render's `PORT` (fallback 5173). `npm run dev` stays on loopback; `npm run start:local` is available for a loopback production preview. Build-time `NEXT_PUBLIC_` settings must belong to the same Supabase project used at runtime; changing them requires rebuilding.

Deployment switches are server-only: `GENERATION_ENABLED` and `CHECKOUT_ENABLED`. Both default to disabled when `NODE_ENV=production`; elsewhere they default to enabled when omitted. Only the exact value `true` enables an explicitly configured switch. Copying `.env.example` explicitly disables both even in local development; set them to `true` in the local test environment if needed. Disabled operations return 503 before allowance reservation, OpenAI requests or Stripe Checkout creation. Existing paid downloads, signed webhook handling, payment reconciliation and deletion stay available.

Before deploying, run CI (`npm test` and `npm run build`). GitHub Actions does this for main pushes and pull requests without credentials. In Render, create a **Web Service**, connect `kazexd/forma`, choose `main`, leave Root Directory blank, and select **Free**. Use:

- Build Command: `npm ci && npm run build`
- Start Command: `npm start`
- Health Check Path: `/api/ready`
- Auto-Deploy: **After CI Checks Pass** (or disable automatic deployment and deploy manually only after CI passes)

Set these Render environment variables before the first build:

- `NODE_ENV=production`
- `CIRCLE_NODE_TOTAL=3` (bounds Next.js build workers to two; no runtime scaling change)
- `GENERATION_ENABLED=false`
- `CHECKOUT_ENABLED=false`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: copy production values directly into Render, never GitHub or chat.

OpenAI and Stripe secrets can stay unset while both operations are closed. Do not upload `.env.production.local`; Next.js reads Render's settings directly. Production Google auth must be enabled in Supabase. A later step adds the actual Render HTTPS origin and `/auth/callback` to the production OAuth redirect configuration. The existing Stripe integration still rejects Live mode; merely inserting a live key will not enable real checkout.

`GET /api/health` remains the lightweight configuration endpoint. `GET /api/ready` reports only `{ready:true|false}` with no-store headers and HTTP 200/503. It checks private bucket metadata, portrait/allowance table columns, required RPC names in the server-authorized schema, and the public Google provider configuration. These are read-only requests: no user creation, generation, allowance reservation, Stripe requests or database RPC execution. Probes have a 4-second network deadline, are coalesced, and are cached for 30 seconds to avoid a Supabase round trip for every Render health check. Failed checks do not leak provider errors or credentials. When operations are explicitly enabled it also checks the corresponding local key/config presence; it does not validate upstream OpenAI billing or process payments.

After deployment, record the `https://...onrender.com` URL and verify readiness, sign-in setup and gallery access while generation and checkout remain closed. Render Free may sleep, restart or exhaust its included resources; this deployment does not remove those limitations or make the public paid launch complete.


## Generation protection rollout (keep both operation switches false)

After setting production Turnstile keys in Render, apply `supabase/migrations/20261118_generation_protection.sql` once to each environment that will run this version. Keep `GENERATION_ENABLED=false` and `CHECKOUT_ENABLED=false` throughout migration and deployment. The migration replaces the unguarded account-debit RPC with `forma_begin_generation` and adds request records, rate limits, a global lease and atomic portrait publishing. Do not roll back to application code that calls the retired `forma_consume_generation` RPC. The old debit RPC remains a fail-closed stub so the previous release’s read-only readiness probe stays healthy. New readiness checks require all new RPCs; apply the migration before deploying. Existing portraits, purchase resets and account balances are preserved.

Render variables (set before rebuilding):

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: production widget's public sitekey, compiled into the browser bundle.
- `TURNSTILE_SECRET_KEY`: server-only secret, never in a public variable.
- `TURNSTILE_HOSTNAME=forma-production.onrender.com`: exact hostname, no scheme/path. If omitted, the server uses Render's `RENDER_EXTERNAL_HOSTNAME`. Keep the widget's hostname allowlist in sync.

The widget uses Managed mode with action `generate_portrait`, explicit rendering, token-expiry/error callbacks, and a fresh challenge after each attempt. Siteverify is mandatory in production even if keys are missing; missing settings fail closed. Unconfigured local development skips the widget/provider only when neither Turnstile key is present. Use Cloudflare test keys in a separate local test configuration if needed, not the production widget on localhost. Tokens travel in `X-Turnstile-Token`, not photo form fields. The backend checks Cloudflare success, exact hostname and action. A token hash is also unique in Postgres because Cloudflare's token-reuse detection is eventually consistent; a concurrent token replay cannot grant another paid generation. No raw token, secret, IP address, or input image is stored in request records.

Initial controls in `forma_generation_control` (server-only):

- 20 accepted upstream attempts per UTC day across the entire site; purchases reset the owner's three attempts, not this site counter.
- One global active generation lease for 15 minutes. Normal success or an explicit upstream rejection releases it immediately. Network timeouts/unknown outcomes retain it until expiry; a new request may proceed afterward, but the old request is never automatically resubmitted. A provider might continue processing after an API timeout, so a lease is not proof that an uncertain upstream task stopped.
- 512 MiB budget for the portrait bucket. Before a new call, count stored object sizes and reserve 21 MiB per running/uncertain request plus the new attempt. This conservatively covers the bucket's maximum original and a preview, and may pause earlier when requests need operator reconciliation. This is an application budget, not a guarantee covering all Supabase buckets, database size, egress or provider quotas.
- Six generation POST requests per authenticated account per fixed UTC minute, checked before reading/decoding photo bodies. Existing auth, same-origin, format, size and pixel limits remain in force. This does not identify a person across multiple Google accounts and is not an IP-level/WAF limit.

The emergency database pause is `update public.forma_generation_control set paused=true where id=true;` in Supabase SQL Editor. Only an operator may change control values. Resume with `paused=false` after inspecting provider usage, storage and unresolved requests. Do not manually mark an uncertain request failed until confirming its upstream/storage outcome; doing so could release reserved storage too early. All failed/uncertain accepted attempts stay counted against both account and site limits. Database RPC availability/permission errors block OpenAI calls.

Every POST now requires a UUID `Idempotency-Key`. An accepted request records owner, style and a SHA-256 fingerprint of the five original inputs. Reusing an ID with different inputs conflicts. Matching replays return only the existing watermarked preview, the existing failure, or an in-progress/uncertain status; they never debit or call OpenAI again. Successful generation uploads private JPEG objects and commits portrait ownership, request success and lease release together. If the commit response is lost, persistence checks for the committed portrait before attempting object cleanup. Unknown commit outcomes retain objects for recovery rather than deleting a possibly committed original.

`GET /api/generation-requests/:id` verifies the account and returns `{request:{id,status,portraitId}}` with no-store headers. Statuses are `running`, `succeeded`, `failed`, `uncertain`. Expired running leases read as uncertain; deleted portraits keep their request tombstone with `portraitId:null`, so deletion cannot make an old request reusable. Requests contain no public image URLs. The browser stores only its pending request UUID in per-account sessionStorage. After a disconnect/reload it checks status without resending photos or debiting again, and can load the saved portrait. An uncertain outcome requires an explicit acknowledgement before a new attempt; the backend limits still apply. Closing the browser does not intentionally abort an accepted upstream call; saving continues while the server remains alive. Input files remain memory-only.

Busy/site-cap/storage/rate rejections do not consume account attempts. Stable rejection codes include `generation_busy`, `site_generation_limit`, `generation_storage_limit`, `generation_rate_limited`, `human_verification_failed`, `generation_allowance_exhausted`, `request_conflict`. Accepted failures use `generation_failed` or `generation_uncertain`; clients must not automatically retry uncertain upstream work.

Validation: `npm test` and `npm run build`; `python scripts/test-generation-db.py <fresh-disposable-postgres-container>` exercises the full migration chain, concurrent debits, duplicate IDs/tokens, daily caps after payment, lease expiry, storage budget, publish rollback and private-role permissions. CI runs this against an isolated Postgres 17 service. Neither these checks nor readiness consumes real OpenAI credits or creates payments.

References: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ and https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/ . This rollout does not enable public generation, activate Stripe Live, provide a job queue, or finish the remaining monitoring/backups/support launch steps.

## Switching image providers

`IMAGE_PROVIDER=openai` (the default) uses `OPENAI_API_KEY` and `OPENAI_IMAGE_MODEL` (default `gpt-image-2`). Set `IMAGE_PROVIDER=openrouter` to use only `OPENROUTER_API_KEY` and `OPENROUTER_IMAGE_MODEL` (default `openai/gpt-image-2`). These are server-only variables: never use a `NEXT_PUBLIC_` prefix. Save the settings and restart locally, or redeploy the Render service. No migration is required. Existing portraits and pending request recovery remain independent of the selected provider. Invalid provider names and missing selected-provider credentials fail before allowance reservation; an unused provider's key is not required.

OpenRouter uses `POST https://openrouter.ai/api/v1/images` with five normalized JPEG data-URL `input_references` and one output. Supported `OPENROUTER_IMAGE_MODEL` values:

| Model | Environment value | Requested output |
| --- | --- | --- |
| GPT Image 2 (default) | `openai/gpt-image-2` | 1024x1536, medium, JPEG |
| Qwen Image 2.1 Turbo | `qwen/qwen-image-2.1-turbo` | 1K, 2:3 portrait |
| Seedream 5.0 Flash | `bytedance-seed/seedream-5-0-flash` | 1K, 2:3 portrait, JPEG |
| Seedream 5.5 | `bytedance-seed/seedream-5-5` | 1K, 2:3 portrait, JPEG |
| Google Nano Banana 2.1 | `google/gemini-nano-banana-2.1` | 1K, 2:3 portrait |

The four alternative models use `resolution` and `aspect_ratio`, without OpenAI-specific `size` or `quality`. Qwen/Google omit `output_format` because it is not advertised in their capability catalog; returned raster images are converted to JPEG. 1K is a provider resolution tier, not a guarantee of exactly 1024x1536. Unknown model IDs fail before allowance reservation and fail readiness when generation is enabled. Other models, including Qwen Pro, need an explicit capability profile before use. Model availability, price, reference identity fidelity and privacy-compatible endpoint availability vary; these have not been validated with paid generations.

For example, set `IMAGE_PROVIDER=openrouter`, `OPENROUTER_API_KEY=<server-only key>` and `OPENROUTER_IMAGE_MODEL=qwen/qwen-image-2.1-turbo`, then restart/redeploy. Switch only the model ID to select another supported model. No database migration or frontend rebuild-specific variable is needed. Output raster images are validated and converted to JPEG before private storage/watermarking. Remote output URLs are not fetched. Responses are bounded to 30 MiB and decoded output to 40 megapixels / 20 MiB JPEG.

There is no automatic cross-provider failover or request retry. OpenRouter endpoint fallback is disabled and `data_collection: deny` excludes endpoints that train on inputs (it does not guarantee zero retention). Uploaded references are sent to OpenRouter and its selected upstream model provider when enabled. Review their policies before allowing customer uploads. The UI consent mentions both available processing routes. Account/site allowances, CAPTCHA, leases, idempotency, failure counting, gallery, payments and watermarks apply identically to both providers. Provider errors do not expose raw responses or keys; unknown outcomes retain the existing recovery protections. A failed accepted attempt still consumes an account attempt.

Keep generation and checkout closed during configuration changes. Readiness checks selected-provider configuration only, not key validity, credit balance or model availability. Verify with mocked tests first, then one deliberate paid generation. Do not automatically rerun an uncertain attempt with the other provider.

Reference: [OpenRouter Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation).
