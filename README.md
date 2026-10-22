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

1. Create a project on the Free plan at https://supabase.com/dashboard. Copy its project URL and publishable key into the environment variables above. No SQL migrations or photo storage buckets are required. Free plan quotas and inactivity rules apply: https://supabase.com/pricing .
2. In Google Cloud / Google Auth Platform, configure the consent screen and create an OAuth client of type **Web application**. Add http://localhost:5173 to Authorized JavaScript origins. For Authorized redirect URIs, use the hosted Supabase callback shown in the Google provider settings, normally https://YOUR_PROJECT.supabase.co/auth/v1/callback . This differs from the frontend callback. If Google is in Testing mode, add your own Google account as a test user.
3. In Supabase **Authentication → Sign In / Providers → Google**, enable Google and enter its Client ID and Client Secret. Keep the Google Client Secret in the Supabase dashboard. Enable new user sign-ups and disable unused providers if you only want Google login.
4. In Supabase **Authentication → URL Configuration**, set Site URL to http://localhost:5173 and add both exact Redirect URLs:
   - http://localhost:5173/auth/callback
   - http://127.0.0.1:5173/auth/callback
5. Start the app and allow the sign-in popup. First login creates a Supabase Auth user; subsequent logins reuse it. A normal Chrome/Edge window may be needed if Google rejects an embedded browser.

Official setup: https://supabase.com/docs/guides/auth/social-login/auth-google and https://supabase.com/docs/guides/auth/redirect-urls . Key types: https://supabase.com/docs/guides/getting-started/api-keys .

## Account and photo flow

Visitors can upload and choose styles. Generation requires a Google account session plus explicit photo-transmission consent. A popup and PKCE preserve the original tab's selected File objects. The callback is a real Next.js page at /auth/callback; the Supabase browser SDK exchanges the code and synchronizes the session between tabs. Blocked, cancelled and failed popups can be retried without losing photos.

Supabase's SDK persists the login session in local storage and refreshes it automatically. Photo selections and generated images remain in memory. Start over clears photos but preserves login. Local sign-out clears the current page's selections/results; it does not delete the account or sign out every device. No photo history, credits or payment flow is included.

## API and image processing

- POST /api/generate is a Node.js Route Handler. It accepts an Authorization: Bearer <Supabase access token> header, exactly five multipart photos files, one style (formal, casual, natural), and consent=true. It returns { photos: [{ id, previewUrl, downloadFilename }] }, with one JPEG data URL. Failures return { error }.
- GET /api/health returns { configured: boolean, authConfigured: boolean } without exposing credentials. API responses use Cache-Control: no-store.
- Server-side Supabase getUser(token) verification rejects missing, expired, invalid or anonymous identities before processing photos or calling OpenAI. Unconfigured or unavailable authentication fails closed. Requests with a different Origin or cross-site fetch metadata are rejected.
- A streaming multipart parser enforces five files, JPEG/PNG/WebP types, 10 MiB per file and a 51 MiB total request limit, including chunked requests without Content-Length. Duplicate/unknown fields and malformed bodies are rejected. Sharp fully decodes the images, rejects animated inputs and images over 40 megapixels, corrects orientation, removes metadata and fits each reference inside 1536 × 1536.
- All five references go to the OpenAI Images edit API with n=1, size=1024x1536, quality=medium and JPEG output. Fixed prompts preserve identity while changing professional clothing, setting and lighting. Actual similarity must be evaluated manually with authorized photos.
- One generation runs at a time **per Node process**. This is not a distributed quota or public-service rate limiter. SDK automatic retries are disabled. Generation can take minutes; timeout or disconnect does not guarantee that processing stopped or that no charge occurred. Check usage before retrying.

The app writes no uploaded/generated photos to disk, database or logs. Only authentication data goes to Supabase; photos are sent to OpenAI when generation is requested. OpenAI's own data policies apply: https://developers.openai.com/api/docs/guides/your-data . No zero-retention claim is made. Downloads are saved only on request. API fees are paid by the configured OpenAI account.

## Validation and deployment notes

```powershell
npm test
npm run typecheck
npm run build
```

Tests cover UI state, authentication/popups, API errors, streaming upload limits, image validation and generation concurrency. Backend tests call standard Request/Response handlers with fake Supabase/OpenAI clients; no paid requests or real Google sign-in occurs. Live OAuth and generated image quality still need verification with your credentials.

The production app needs a Node.js Next.js server; static export is not supported because the API is dynamic. Route Handlers explicitly use the Node runtime for Sharp/stream processing. Hosting platforms may impose smaller upload limits and shorter execution limits than the app permits; the exported maxDuration is only a platform hint. Multi-instance deployment additionally needs shared rate limiting and generation quotas. No deployment is included in this migration.

Illustrative style photos are local stock assets, not generated results or endorsements. Sources: public/photos/SOURCES.txt; license: https://unsplash.com/license .
