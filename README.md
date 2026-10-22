# Forma — Professional Photo MVP

React + TypeScript + Vite frontend with a local Node.js/Express backend. Upload **exactly 5 photos**, choose one of three styles, and generate **1 real AI portrait** with OpenAI. Google sign-up/sign-in is managed by Supabase Auth. No application database, photo history or payment UI is added.

## Set up and run locally

Requires Node.js **22.16 or later** and npm. In PowerShell:

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` locally and set `OPENAI_API_KEY` to a key from https://platform.openai.com/api-keys. Configure API billing and ensure your project has access to the image model; organization verification may be required. Keep the key private; never paste it into chat or use a `VITE_` prefix. `.env` is ignored by Git. Do not overwrite an existing `.env` when repeating setup.

```dotenv
OPENAI_API_KEY=your-key-here
OPENAI_IMAGE_MODEL=gpt-image-2
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

```powershell
npm run dev
```

This starts both services: frontend http://127.0.0.1:5173 and backend http://127.0.0.1:3001. Stop any earlier frontend-only preview first. Restart after changing `.env`. The Vite `/api` proxy routes requests to the backend. Without a key the interface still opens, but generation returns a configuration error; it never silently returns stock images. The local origin allowlist expects port 5173.

## Supabase Free + Google sign-in setup

1. Create a project on the **Free** plan at https://supabase.com/dashboard. No paid Supabase features or email sender are required for this Google-only implementation. The Free plan has quotas and may pause inactive projects; check https://supabase.com/pricing before launch.
2. Copy the project URL and **publishable key** from the project's Connect/API settings into the two VITE_SUPABASE variables in your local .env. A legacy anon key also works. These two values are intentionally public; they are used by the browser and backend. **Never put a secret/service_role key in a VITE_ variable.** No Supabase secret key is needed here.
3. In Google Cloud / Google Auth Platform, configure the consent screen and create an OAuth client of type **Web application**. Add your local app origin (http://localhost:5173) to Authorized JavaScript origins. For **Authorized redirect URIs**, copy the callback URL shown in Supabase's Google provider settings (normally https://YOUR_PROJECT.supabase.co/auth/v1/callback). This is the hosted Supabase callback, not the frontend callback or a local Supabase CLI URL. If Google is in testing mode, add your own Google account as a test user.
4. In Supabase **Authentication → Sign In / Providers → Google**, enable Google and enter the Google Client ID and Client Secret. Keep the Google Client Secret in the Supabase dashboard, never in the frontend or Git. Ensure new user sign-ups are enabled. Disable unused login providers if you only want Google.
5. In Supabase **Authentication → URL Configuration**, set Site URL to http://localhost:5173 and add BOTH exact Redirect URLs:
   - http://localhost:5173/auth/callback
   - http://127.0.0.1:5173/auth/callback
6. Restart npm run dev, then open http://localhost:5173. Allow the Google sign-in popup. The first successful login creates a Supabase Auth user; later logins reuse that account. No SQL migrations or photo storage buckets are needed.

Official setup: https://supabase.com/docs/guides/auth/social-login/auth-google and https://supabase.com/docs/guides/auth/redirect-urls . API key types: https://supabase.com/docs/guides/getting-started/api-keys .

### Account behavior

Visitors can upload five photos and select a style. Generation is disabled until signed in and consent is checked. Login uses a popup and PKCE, preserving the selected File objects and style in the original tab. The callback exchanges the code using Supabase's SDK and closes; auth state is synchronized across tabs. A blocked, cancelled or failed popup shows a retry message without discarding photos. Google may require using a regular system browser rather than an embedded browser.

The session is persisted by Supabase's browser SDK in local storage and refreshed automatically. Photo files/results are still memory-only. Signing out locally clears the current page's photo selections and result; it does not delete the Supabase account or sign out every device. Starting over clears photos but leaves the account signed in.

The backend independently calls Supabase getUser(accessToken) on each generation request. Missing/invalid/expired tokens are rejected with 401, and missing auth configuration or an unavailable verification service fails closed with 503. No OpenAI call occurs before authentication succeeds. Anonymous Supabase identities are not allowed. The browser never sends photos to Supabase; Supabase stores the account and session data only. This adds authentication, not user credits, billing or public-service abuse controls.

If Supabase is not configured, the upload/style UI remains usable and shows setup guidance, but generation stays protected. A real Google OAuth round trip must be tested once your own project and provider are configured; automated tests use fake auth/provider clients, not a live account.

## Generation behavior and cost

The server calls the OpenAI Images edit API with all five references, `n: 1`, `size: 1024x1536`, `quality: medium`, and JPEG output. The default model is `gpt-image-2`; change it only to a model supporting these options. Each style uses a fixed prompt emphasizing identity, realistic skin, clothing and lighting. Identity similarity is not guaranteed and needs manual testing with authorized photos.

Generation can take minutes. One generation is allowed at a time. Automatic SDK retries are disabled to avoid accidentally repeating paid calls. A timeout or browser disconnect does not guarantee OpenAI stopped processing or that no charge occurred; check usage before retrying. API charges are paid by the configured OpenAI account. Tests do not call OpenAI.

## Data handling

The browser accepts JPEG, PNG and WebP, at most 10 MiB each, with exactly five images required. Photo files are not sent until the user is signed in, checks the photo permission/transmission consent and clicks Generate. Google/Supabase receive authentication requests during sign-in. The backend independently validates counts, style, consent, size and actual decoded image content (non-animated, up to 40 megapixels). It corrects orientation, strips metadata and downsizes each reference to fit within 1536 × 1536 before sending it to OpenAI.

Uploads and generated images are held in memory only; the app writes no photos to disk, database or logs. OpenAI handles submitted data under its own API data policies: https://developers.openai.com/api/docs/guides/your-data . This is not a promise of zero retention by OpenAI. Refresh or Start over clears the browser session. Downloads are saved only at the user's request. No analytics or external fonts are loaded.

## Interfaces and validation

- `POST /api/generate`: requires an Authorization: Bearer <Supabase access token> header and a multipart form with exactly five `photos` files, `style` (`formal`, `casual`, `natural`) and `consent=true`. Returns `{ photos: [{ id, previewUrl, downloadFilename }] }`, with one JPEG data URL. Errors return `{ error }`.
- `GET /api/health`: `{ configured: boolean, authConfigured: boolean }`; never reveals key contents.
- `src/photos.ts`: `generatePhotos(files, style): Promise<GeneratedPhoto[]>` adapts the API response for preview and download.

```powershell
npm test
npm run build
```

Tests cover frontend validation, consent, popup/session behavior, authenticated API submission/errors, UI state and backend routes with an injected fake OpenAI client. No paid requests are made. `npm run build` builds the frontend; `npm run dev` runs both local services. Deployment, authentication and public-service rate limiting are outside this local MVP; the backend binds to loopback only.

## Illustrative style photos

Bundled stock photos are style references, not generated results or endorsements. Sources are in `public/photos/SOURCES.txt`, under the Unsplash license: https://unsplash.com/license . They are served locally; actual results always come from OpenAI.

Official image API reference: https://developers.openai.com/api/reference/resources/images/methods/edit
