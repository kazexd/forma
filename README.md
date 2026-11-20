# Forma

AI-generated professional portraits from five recent photos. Built with **Next.js App Router, React and TypeScript**, with Google authentication/private storage through Supabase, image generation through OpenAI or OpenRouter, and one-time Stripe Checkout purchases.

Website: [forma.jo3.org](https://forma.jo3.org) · Support: [forma.portraits@gmail.com](mailto:forma.portraits@gmail.com)

## User flow

1. Sign in with Google. New accounts receive **3 free generation attempts** and **0 original-unlock credits**.
2. Upload exactly **5 photos**, then choose Business Formal, Business Casual or Natural Professional.
3. Generate **1 portrait**, preview it with an embedded watermark and find it in **My Gallery**.
4. Purchase a specific original, or spend one unlock credit, to download/share the watermark-free version.
5. Buy more credits when needed. **Every purchase is a one-time payment: no monthly subscription or automatic renewal.**

The header displays both balances; clicking them opens the purchase-options modal. Gallery supports All / Unpaid / Purchased filters, newest-first pagination with 12 photos per page, details, purchases, downloads, sharing and permanent deletion. Start over clears the current creation flow, not saved portraits.

Accounts created after the welcome migration see an introductory modal on the home page. Confirmation is stored on the server, so it stays dismissed across browsers/logins. Existing accounts are not enrolled retroactively.

## Prices and credit rules

Current prices are in **CAD**, before eligible discounts.

| Purchase | Price | Generation attempts | Original unlocks |
| --- | --- | --- | --- |
| One specified original portrait | CA$3.99 | 0 | Unlocks that portrait only |
| Starter package | CA$4.49 | 3 | 1 |
| Plus package | CA$5.49 | 5 | 2 |

[src/portrait-price.mjs](src/portrait-price.mjs) defines prices and package contents. Generation/unlock balances are separate, accumulate and do not reset daily or expire while the account and service remain available. Buying an original does not add attempts or reset balances. Downloading an already-unlocked original costs no further credit.

### Generation failure handling

- Invalid input, failed authentication, unavailable configuration and capacity rejections do not debit an attempt.
- Accepted generation reserves **one attempt before the provider call**.
- A delivered portrait counts even if the user dislikes its likeness/style/expression. Deleting it does not restore the attempt.
- **Confirmed technical non-delivery restores one attempt, at most once per request.** This includes explicit provider failures, invalid output, processing/upload failures and confirmed publication rollback.
- Unknown provider timeouts/connections or lost database responses remain **uncertain**. The attempt stays held until the outcome is confirmed. Lease expiry alone does not restore it; some cases require operator investigation.

Restoration applies only to requests accepted after its migration. Historical failures are not reimbursed automatically. Restoring an internal attempt does not move money through Stripe, alter unlock credits or reduce the site's daily usage counter.

## Architecture

The frontend/API run in one Node.js Next.js process. There is no Express backend, frontend proxy or port 3001 service.

| Location | Responsibility |
| --- | --- |
| `src/App.tsx`, `src/Gallery.tsx` | Creation/results and private portrait collection |
| `src/Header.tsx`, `src/CreditPlansModal.tsx` | Account controls, balances and purchase options |
| `src/AccountWelcome.tsx` | New-account introduction and acknowledgement |
| `src/useAuth.tsx`, `src/auth.ts` | Google popup/PKCE and Supabase sessions |
| `src/server/portraits.mjs` | Validation, identity prompt and image generation |
| `src/server/image-provider.mjs` | OpenAI/OpenRouter configuration and adapter |
| `src/server/commerce.mjs`, `src/server/checkout-receipt.mjs` | Checkout, payment reconciliation and discounted-total verification |
| `src/server/portrait-store.mjs` | Private Supabase database/storage access |
| `src/legal-config.ts`, `src/app/(legal)/` | Public support details and policy pages |
| `supabase/migrations/`, `scripts/test-*-db.py` | Schema/RPC migrations and disposable-database tests |

## Local setup

Use **Node.js 22** (`.node-version`; engines require `>=22 <23`) and npm.

```powershell
npm ci
# Only if .env does not already exist:
Copy-Item .env.example .env
```

Use a separate **testing Supabase project** and **Stripe sandbox/test** credentials. Apply all required migrations below before testing generation, Gallery or credits. Configure `.env`:

```dotenv
IMAGE_PROVIDER=openai
OPENAI_API_KEY=your-openai-key
OPENAI_IMAGE_MODEL=gpt-image-2
NEXT_PUBLIC_SUPABASE_URL=https://your-testing-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-public-project-key
SUPABASE_SERVICE_ROLE_KEY=your-server-only-key
STRIPE_MODE=test
GENERATION_ENABLED=true
CHECKOUT_ENABLED=false
SUPPORT_EMAIL=forma.portraits@gmail.com
```

```powershell
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) or [http://localhost:5173](http://localhost:5173). Port 5173 is intentional and must match Supabase's frontend redirect URLs.

**Check environment overrides:** `.env.development.local` can override `.env`, including an old `GENERATION_ENABLED=false` or a different provider. Next.js can load `.env.production.local` during production builds/starts; verify the project before previewing a production build. A custom file such as `.env.live.local` is **not loaded automatically**. Filenames do not guarantee that keys, database and billing mode match.

The example file explicitly disables generation and checkout. Enable only the operations being tested. Restart the dev server after environment changes; public `NEXT_PUBLIC_` changes require a production rebuild. Never commit keys or local environment files.

For a production build on loopback, stop the dev server first:

```powershell
npm run build
npm run start:local
```

## Environment settings

See [.env.example](.env.example) for the full template.

| Variable | Purpose |
| --- | --- |
| `IMAGE_PROVIDER` | `openai` (default) or `openrouter`; only the selected provider needs a key |
| `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL` | Direct OpenAI key/model; code default is `gpt-image-2` |
| `OPENROUTER_API_KEY`, `OPENROUTER_IMAGE_MODEL` | OpenRouter key/model; default is `openai/gpt-image-2` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public project URL and publishable/legacy anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role/secret key; never use a `NEXT_PUBLIC_` prefix |
| `STRIPE_MODE` | `test` or `live`; must match the database billing mode |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Matching Stripe API key and endpoint/listener signing secret |
| `STRIPE_PRICE_ID` | One-time 399-cent CAD original portrait Price |
| `STRIPE_STARTER_PACKAGE_PRICE_ID` | One-time 449-cent CAD Starter Price |
| `STRIPE_PACKAGE_PRICE_ID` | One-time 549-cent CAD Plus Price |
| `GENERATION_ENABLED`, `CHECKOUT_ENABLED` | Explicit `true` enables a configured switch; defaults are off in production, on in development when omitted |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Matching widget public key and server secret |
| `TURNSTILE_HOSTNAME` | Exact hostname, no scheme/path; falls back to `RENDER_EXTERNAL_HOSTNAME` |
| `APP_ORIGIN` | Trusted public origin, e.g. `https://forma.jo3.org`; falls back to Render's external URL/hostname |
| `SUPPORT_EMAIL` | Public contact/privacy email; defaults to `forma.portraits@gmail.com` |

Support email is read on the server by statically generated Contact/Privacy/Terms pages. Rebuild/redeploy after changing it; no `NEXT_PUBLIC_` prefix is needed. Stripe's public customer-support email is a separate Dashboard setting.

Obsolete settings `DAILY_GENERATION_LIMIT`, `UNPAID_RETENTION_DAYS` and `VITE_SUPABASE_*` do not control the current app.

## Supabase and Google authentication

1. Create separate testing and production Supabase projects, with matching public/server keys in each app environment.
2. Configure a Google **Web application** OAuth client and enable the Google provider in Supabase. Google's Authorized redirect URI is the **Supabase** callback from provider settings: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`. Keep the Google Client Secret in Supabase. Add test users if Google's consent screen is in Testing mode.
3. In the **testing** project's URL Configuration, use a local Site URL and allow both frontend callbacks:
   - `http://localhost:5173/auth/callback`
   - `http://127.0.0.1:5173/auth/callback`
4. In **production**, set Site URL to `https://forma.jo3.org` and allow `https://forma.jo3.org/auth/callback`. Also allow the `www` callback if that hostname is served; use the canonical hostname consistently. Keep the old Render callback temporarily if needed.

The Google-to-Supabase and Supabase-to-frontend callbacks are different. A missing frontend allowlist entry can send the popup to an old Site URL, leaving the original tab unsigned-in. Close the old popup and start a new login after correcting settings.

Popup/PKCE login preserves uploaded File objects in the original tab. The callback exchanges the code, synchronizes the same-origin session and closes the popup. Supabase persists/refreshes sessions in browser local storage. Local sign-out clears the current flow, not the account or every device. Photo selections remain in memory.

References: [Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [API key types](https://supabase.com/docs/guides/api-keys).

## Database migrations

Apply migrations separately in testing and production, **once each, in this explicit order**. Do not rely on alphabetical order or rerun already-applied files.

| Order | Migration | Purpose |
| --- | --- | --- |
| 1 | `20261030_paid_portraits.sql` | Portrait/payment records and private bucket |
| 2 | `20261031_purchase_generation_allowance.sql` | Historical allowance implementation |
| 3 | `20261031_personal_gallery.sql` | Permanent Gallery retention/deletion |
| 4 | `20261118_generation_protection.sql` | Request IDs, global lease, caps and atomic publication |
| 5 | `20261118_purchase_credits.sql` | Additive generation/unlock balances and orders |
| 6 | `20261119_stripe_modes.sql` | Test/Live isolation and operator-only activation |
| 7 | `20261119_stripe_modes_cad.sql` | CAD reservations, historical USD preservation |
| 8 | `20261119_stripe_modes_preserve_credits.sql` | Live activation preserves balances |
| 9 | `20261119_stripe_promotions.sql` | Discounted/zero-total fulfillment and receipts |
| 10 | `20261119_new_account_welcome.sql` | New-account welcome eligibility/acknowledgement |
| 11 | `20261119_credit_package_options.sql` | Starter 3+1 and Plus 5+2 snapshots |
| 12 | `20261119_restore_failed_generation.sql` | Exactly-once technical-failure restoration |

Existing deployments should apply **only missing migrations**. Historical files contain older rules intentionally replaced by later migrations. Ordinary schema migration does not activate Live or reset balances. Welcome eligibility starts after migration 10; restoration eligibility starts with requests accepted after migration 12.

Back up the database and pause generation before rollout. For payment/credit changes, stop app instances, webhook/reconciliation handlers and cleanup workers while applying SQL and switching code. Flags alone do not stop payment confirmations. Resume only with matching schema/code; retired RPCs are deliberately inaccessible to the backend role. Verify testing before upgrading production. Never execute database fixture scripts against hosted projects.

## Image generation and prompt

Direct OpenAI uses the Images edit endpoint. Choose an edit-compatible model with `OPENAI_IMAGE_MODEL`, then restart/redeploy; the code fallback remains `gpt-image-2`. Model changes need no migration. There is no automatic model upgrade, provider failover, Batch integration or paid retry.

OpenRouter supports these exact IDs and provider-specific settings:

| Model | Settings |
| --- | --- |
| `openai/gpt-image-2` | 1024×1536, medium, JPEG |
| `qwen/qwen-image-2.1-turbo` | 1K, 2:3 |
| `bytedance-seed/seedream-5-0-flash` | 1K, 2:3, JPEG |
| `bytedance-seed/seedream-5-5` | 1K, 2:3, JPEG |
| `google/gemini-nano-banana-2.1` | 1K, 2:3 |

The OpenRouter adapter sends all five references as data URLs, disables provider fallback and uses `data_collection: deny` to exclude endpoints that train on inputs. This is not a zero-retention guarantee. OpenAI and OpenRouter model names/settings are separate. Remote output URLs are not downloaded; responses are bounded to 30 MiB, decoded originals to 40 megapixels/20 MiB JPEG.

The current prompt in [src/server/portraits.mjs](src/server/portraits.mjs) combines a shared portrait instruction with the selected style:

- Generate one photorealistic head-and-shoulders portrait of the same person shown in all five references.
- Use all references to preserve recognizable identity, facial proportions, skin tone, age, hairstyle and natural skin texture.
- Avoid blending identities, changing ethnicity, reshaping the face or applying heavy beauty retouching.
- Request a camera-facing subject with a **relaxed, confident expression**. The prompt does not explicitly require a smile or choose a primary reference image.
- Apply the selected clothing, background and lighting description, with no text, watermark or collage. Forma adds its own preview watermark after generation.

Prompt instructions do not guarantee likeness. Evaluate with the same consented photos, style and model; automated tests verify the request flow, not visual similarity. Direct OpenAI still requests one image at `1024x1536`, `medium` quality, JPEG output.

There is no fixed seed. Separate new Generate requests using the same photos can produce different results, each using an attempt under the rules above. Replaying/checking the **same request ID** retrieves its outcome without a new provider call or debit.

## Validation, protection and recovery

The Node route verifies Supabase bearer identity, origin, consent and style. It accepts exactly five JPEG/PNG/WebP files, up to 10 MiB each and 51 MiB total multipart input. Duplicate/unknown fields, malformed bodies, animations and images over 40 megapixels are rejected. Sharp corrects orientation, strips metadata and fits references within 1024×1024 without upscaling.

Reference uploads remain in application memory and are sent to the selected AI provider. Forma does not save them as Gallery objects or log their bytes. Third-party processing follows provider policies; no zero-retention promise is made. Provider fees occur before the user decides to purchase.

Initial database controls are:

- **20 accepted attempts per UTC day across the site**, independent of user balances/package purchases. Account-credit restoration does not reduce this counter.
- **One global generation lease for 15 minutes**, plus one upload/decode request per Node process. Success/confirmed failure releases the lease; uncertain work retains it until expiry. Expiry does not prove upstream work stopped.
- **512 MiB portrait-bucket budget**, counting stored bytes plus 21 MiB per unresolved/new request. This is an app budget, not the full Supabase quota.
- **Six generation POST requests per account per fixed UTC minute**, before buffering photos; not a cross-account/IP-level limit.

An operator can pause via `forma_generation_control.paused`. Inspect provider usage, private storage and unresolved requests before resuming. No raw CAPTCHA token, reference photo, secret or client IP is stored in generation records.

Each accepted request has a UUID `Idempotency-Key`, owner, style and input fingerprint. Reusing an ID with different photos/style conflicts. The browser stores only its pending UUID in per-account sessionStorage, then checks status after reload instead of resubmitting.

`forma_finish_generation_restoring` atomically marks confirmed failure and restores one attempt, with `restored_at` preventing duplication. Billing/global/account/request locks coordinate restoration with payment and publication. A request cannot both publish successfully and restore. Deleted successful portraits keep a request tombstone and stay charged.

Unknown provider/publication outcomes remain held, with possibly committed files preserved. After confirming terminal non-delivery, an operator/backend may resolve using `forma_finish_generation_restoring(owner_uuid, request_uuid, false)`. Never mark failure based only on expiry or a missing photo. Transaction failure rolls back both status and balance. Private orphaned uploads may need operator cleanup and continue counting toward storage capacity.

## Stripe setup and fulfillment

Create separate one-time **CAD** Prices in the matching Stripe environment for originals, Starter and Plus. Suggested Product names: Forma Portrait, Forma Starter Package and Forma Plus Package. The server checks active status, mode, amount, currency and one-time pricing; browser-supplied amounts/credit counts are not trusted.

Restricted-key permissions used are **Checkout Sessions Write** and **Prices Read**. Hosted Checkout needs no frontend Stripe publishable key. Configure `/api/stripe/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`.

For local sandbox forwarding:

```sh
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded --forward-to http://127.0.0.1:5173/api/stripe/webhook
```

Set the listener's signing secret in `STRIPE_WEBHOOK_SECRET`; it differs from a Dashboard endpoint secret. Enable checkout only after keys, all three CAD Prices, webhook and database mode match. Use Stripe test payment details in sandbox, not real card details.

### Promotion codes and payment validation

New Sessions allow customer-facing promotion codes. Configure coupons/codes, expiry, product restrictions and redemption limits in Stripe. Percentage/fixed discounts and verified 100% discounts are supported. `Duration: Once` is not a per-user usage limit. Product-restricted codes must include any newly created package Products. Google sign-in alone does not associate an account with a customer-restricted Stripe code.

Signed webhooks and authenticated status refresh retrieve Stripe line items and verify owner, saved Session/idempotency snapshot, mode, quantity, Price ID, subtotal, currency, applied discounts and totals. A zero-total order requires a completed/settled Session and a verified full discount; no PaymentIntent is required. A success redirect alone never grants access or credits.

Package fulfillment marks the order paid, grants its saved **3+1 or 5+2** and inserts a private receipt in one transaction, once only. Original payment unlocks only that photo. Receipts preserve original price, discount, tax components, actual total and discount references. Later coupon expiry does not invalidate a completed purchase.

One pending checkout is allowed per account **per package**; Starter never silently reuses Plus. Existing reservations retain their creation parameters/idempotency key; older ones may lack code entry. Historical USD/test records retain their original snapshots. Reconcile lost Session IDs/creation responses in Stripe before clearing or replacing anything. Expired idempotency windows fail closed rather than risking duplicate payment.

### First Live activation

Use separate testing/production Supabase projects. A fresh database starts in `test` mode even if Live keys exist. For its **first deliberate Live cutover only**, after all migrations and with app/payment processing stopped, an operator can run:

```sql
select public.forma_activate_live('ACTIVATE LIVE AND PRESERVE EXISTING CREDITS');
```

This is not a routine deployment step and is inaccessible to browser/service-role clients. It preserves balances, photos and unlocked originals, expires pending test package orders and clears unpaid test reservations. It does not grant new free credits or reset accounts. Cutover is one-way, once-only, transactional and blocked by an active generation lease. The historical reset-to-2/0 confirmation is rejected; do not manually reverse production mode.

Set `STRIPE_MODE=live`, matching Live API/webhook keys and all three Live CAD Prices before enabling production checkout. Stripe public support/policy details must be updated separately. A free discounted checkout tests fulfillment, not real card charging. This integration does not enable automatic tax.

References: [Stripe keys](https://docs.stripe.com/keys), [fulfillment](https://docs.stripe.com/checkout/fulfillment), [webhooks](https://docs.stripe.com/webhooks).

## Gallery storage, deletion and sharing

The `forma-portraits` bucket is private. The backend saves a clean original plus a preview with repeated FORMA PREVIEW marks embedded in its pixels, not a CSS overlay. Before unlock, only the preview is served. Purchased thumbnails/details show the original. Every list/detail/image/download validates ownership; responses are `no-store`, with no public original or signed Storage URL.

Portraits do not expire. Thumbnails use authenticated requests and temporary Blob URLs released on unmount. Account changes clear account-specific UI; lists return sanitized metadata/opaque cursors, not storage paths.

Deletion requires explicit confirmation matching the displayed paid state. Open unpaid Sessions are expired/reconciled first; pending/unresolved payments block deletion. Newly discovered payment is fulfilled and needs fresh confirmation. Storage failures leave a hidden `deleting` record for safe retry. Cleanup resumes only these owner-confirmed deletions:

```powershell
npm run cleanup:portraits
```

There is no age-based expiry cleanup. Do not run obsolete cleanup jobs against this schema. Physically deleted photos cannot be recovered.

Purchased originals support downloads and X/LinkedIn/Facebook/other-app sharing. Native file sharing depends on browser/device support and a secure context. Desktop fallbacks download the JPEG and open the destination for manual attachment. Forma does not automatically publish, connect social accounts or expose private image URLs; opening a composer/share sheet is not proof of posting.

## API overview

App endpoints below require Supabase bearer authentication except health/readiness; mutations validate origin where applicable. Stripe webhooks use signature verification instead. Private responses disable caching.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/generate` | Five multipart `photos`, `style`, `consent=true`; UUID `Idempotency-Key`; Turnstile header as configured |
| `GET /api/generation-requests/:id` | Owner-only `{request:{id,status,portraitId,attemptRestored}}` |
| `GET /api/generation-allowance` | `{remaining,unlocks,mode}` |
| `GET /api/account-welcome`, `POST /api/account-welcome` | Read eligibility / acknowledge the current account's welcome |
| `GET /api/portraits` | Gallery filters and cursor pagination |
| `GET /api/portraits/:id` | Preview/original and paid status |
| `GET /api/portraits/:id/thumbnail` | Authenticated JPEG, up to 480×640 |
| `GET /api/portraits/:id/download` | Paid/unlocked JPEG attachment; 402 before unlock |
| `POST /api/portraits/:id/checkout` | Original purchase |
| `POST /api/portraits/:id/unlock` | Spend one unlock credit once |
| `DELETE /api/portraits/:id` | Delete with `{confirm:true,paid:boolean}` |
| `POST /api/credit-packages/checkout` | JSON `{"package":"starter"}` / `{"package":"plus"}`; empty legacy requests default to Plus |
| `GET /api/credit-packages/:id` | Owner-only order status/payment reconciliation |
| `POST /api/stripe/webhook` | Signed completion events |
| `GET /api/health` | Configuration-presence booleans, no credentials |
| `GET /api/ready` | Read-only deployment readiness, 200/503 |

Request states are `running`, `succeeded`, `failed` and `uncertain`; expired running leases read as uncertain. Failures include an error and, where applicable, stable code/request ID/restoration flag. Common codes include `generation_allowance_exhausted`, `generation_busy`, `site_generation_limit`, `generation_storage_limit`, `generation_rate_limited`, `human_verification_failed`, `request_conflict`, `generation_failed` and `generation_uncertain`. Never automatically resubmit unknown outcomes.

## Render, custom domain and Turnstile

Use a Node.js Render **Web Service** for `kazexd/forma`, branch `main`:

- Build: `npm ci && npm run build`
- Start: `npm start` (binds `0.0.0.0` and Render's `PORT`, fallback 5173)
- Health check: `/api/ready`
- Auto-deploy: After CI Checks Pass, or manual deployment after CI succeeds
- `NODE_ENV=production`; optional `CIRCLE_NODE_TOTAL=3` bounds build workers

Static export is unsupported. Hosting upload/execution limits still apply; `maxDuration` is a hint. Initial deployment can keep both operation flags false while validating auth, schema and private storage.

For the custom domain:

1. Add `forma.jo3.org` in Render, configure the required DNS records and wait for verification/valid HTTPS. A CNAME editor labelled Alias is not necessarily an apex-flattening ALIAS implementation.
2. Set `APP_ORIGIN=https://forma.jo3.org` and `TURNSTILE_HOSTNAME=forma.jo3.org` in Render. Use the same canonical hostname in the browser.
3. Update the **production** Supabase Site URL and exact frontend callback allowlist. Google's Supabase callback stays separate.
4. Add `forma.jo3.org` to the existing Turnstile widget's Hostname Management. Existing keys remain usable for the same widget. Hostnames have no scheme/path.
5. Rebuild/redeploy, then test sign-in popup return, human verification, Gallery, generation and payment return. Keep any old `onrender.com` webhook working until it is deliberately migrated.
6. Update Stripe's public website/contact/privacy/terms links to the new domain and its public support email separately.

Turnstile is mandatory in production. The backend checks success, exact hostname and action `generate_portrait`; a token hash prevents replay. Development skips verification only when neither key is configured; partial settings fail closed. Use a separate suitable test configuration for localhost. **Current `/api/ready` generation checks require full Turnstile settings even in development**, so the local generation route can work without keys while readiness reports false. Production requires the full configuration in both places.

Readiness checks private bucket metadata, portrait/allowance columns, required RPC names, Google enablement, billing mode and enabled-operation configuration. It makes no mutating RPC/model/Stripe calls, coalesces requests and caches results for 30 seconds with a four-second network deadline. It does not establish key validity, model billing, Stripe Price correctness or successful payment. `/api/health` likewise reports presence, not upstream validity.

## Tests and CI

```powershell
npm test
npm run typecheck
npm run build
```

[CI](.github/workflows/ci.yml) runs for pushes/PRs to `main`: Node 22, `npm ci`, frontend/backend Vitest, disposable PostgreSQL 17 migration/transaction tests, then production build. Generation/checkout are disabled. New runs on the same ref cancel older ones.

The current DB entrypoint, `scripts/test-generation-restoration-db.py`, runs the full historical chain. It covers ownership/permissions, exactly-once package/discount fulfillment, welcome state, restoration, publication-versus-failure races, concurrent payments/debits, rollback and historical snapshots.

Run manually only against a **fresh disposable** Docker database named `forma_test`:

```powershell
docker run --rm -d --name forma-db-test -e POSTGRES_PASSWORD=disposable-only -e POSTGRES_DB=forma_test postgres:17-alpine
# Wait for PostgreSQL readiness before running tests.
docker exec forma-db-test pg_isready -U postgres -d forma_test
python scripts/test-generation-restoration-db.py forma-db-test
docker stop forma-db-test
```

Fixture scripts create schemas/roles and exercise historical mode transitions: never use an existing app database. Vitest uses injected providers and synthetic events, not paid generation, real Google login or card charges. Real image likeness and OAuth/Turnstile/checkout need separate end-to-end checks. CI does not apply hosted migrations, configure dashboards, confirm a Render deployment or run browser E2E tests.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Generation temporarily unavailable | `GENERATION_ENABLED=true`, including `.env.development.local` overrides; restart |
| Checkout temporarily unavailable | `CHECKOUT_ENABLED=true` in the intended environment |
| Image provider not configured | Selected provider has its own key; an OpenAI key does not configure OpenRouter |
| `401 expired_secret_key` | Replace the effective OpenAI key; presence does not establish validity |
| Login only inside popup/on old domain | Supabase Site URL and current-origin `/auth/callback` allowlist; restart sign-in |
| Turnstile fails | Widget hostname allowlist, matching keys, backend hostname, network/extensions and Cloudflare error code |
| Private storage unavailable | All migrations, matching project/server key and private bucket |
| Uncertain attempt | Check request/Gallery; do not blindly regenerate or restore based only on timeout |
| Starter checkout unavailable | Matching active one-time 449-cent CAD `STRIPE_STARTER_PACKAGE_PRICE_ID` |
| Payment pending | Authenticated refresh/webhook delivery; success URLs are not proof |
| CI passed but old UI/endpoint remains | Verify the deployed Render commit separately |
| Support email unchanged | Set `SUPPORT_EMAIL`, rebuild static pages and update Stripe separately |

## Contact, policies and assets

Public pages: [Contact](https://forma.jo3.org/contact), [Privacy Policy](https://forma.jo3.org/privacy), [Terms](https://forma.jo3.org/terms). Operator: Zephyr Wong, Ontario, Canada. Support/privacy email defaults to `forma.portraits@gmail.com` via `SUPPORT_EMAIL`.

Account/privacy requests are handled manually. Verify ownership and inspect dependent payment/security records before account closure. Gallery deletion does not immediately erase provider backups, Stripe records or all request metadata. The app does not automatically handle account deletion or payment disputes.

Illustrative style photos are local stock assets, not generated results or endorsements. See [public/photos/SOURCES.txt](public/photos/SOURCES.txt) and the [Unsplash license](https://unsplash.com/license).

References: [Supabase Storage](https://supabase.com/docs/guides/storage/buckets/fundamentals), [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation), [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data), [Render custom domains](https://render.com/docs/custom-domains), [Turnstile errors](https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/).
