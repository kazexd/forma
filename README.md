# Forma — Professional Photo MVP

React + TypeScript + Vite frontend with a local Node.js/Express backend. Upload **exactly 5 photos**, choose one of three styles, and generate **1 real AI portrait** with OpenAI. No accounts, database, history or payment UI.

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
```

```powershell
npm run dev
```

This starts both services: frontend http://127.0.0.1:5173 and backend http://127.0.0.1:3001. Stop any earlier frontend-only preview first. Restart after changing `.env`. The Vite `/api` proxy routes requests to the backend. Without a key the interface still opens, but generation returns a configuration error; it never silently returns stock images. The local origin allowlist expects port 5173.

## Generation behavior and cost

The server calls the OpenAI Images edit API with all five references, `n: 1`, `size: 1024x1536`, `quality: medium`, and JPEG output. The default model is `gpt-image-2`; change it only to a model supporting these options. Each style uses a fixed prompt emphasizing identity, realistic skin, clothing and lighting. Identity similarity is not guaranteed and needs manual testing with authorized photos.

Generation can take minutes. One generation is allowed at a time. Automatic SDK retries are disabled to avoid accidentally repeating paid calls. A timeout or browser disconnect does not guarantee OpenAI stopped processing or that no charge occurred; check usage before retrying. API charges are paid by the configured OpenAI account. Tests do not call OpenAI.

## Data handling

The browser accepts JPEG, PNG and WebP, at most 10 MiB each, with exactly five images required. Nothing is sent until the user checks the photo permission/transmission consent and clicks Generate. The backend independently validates counts, style, consent, size and actual decoded image content (non-animated, up to 40 megapixels). It corrects orientation, strips metadata and downsizes each reference to fit within 1536 × 1536 before sending it to OpenAI.

Uploads and generated images are held in memory only; the app writes no photos to disk, database or logs. OpenAI handles submitted data under its own API data policies: https://developers.openai.com/api/docs/guides/your-data . This is not a promise of zero retention by OpenAI. Refresh or Start over clears the browser session. Downloads are saved only at the user's request. No analytics or external fonts are loaded.

## Interfaces and validation

- `POST /api/generate`: multipart form with exactly five `photos` files, `style` (`formal`, `casual`, `natural`) and `consent=true`. Returns `{ photos: [{ id, previewUrl, downloadFilename }] }`, with one JPEG data URL. Errors return `{ error }`.
- `GET /api/health`: `{ configured: boolean }`; never reveals key contents.
- `src/photos.ts`: `generatePhotos(files, style): Promise<GeneratedPhoto[]>` adapts the API response for preview and download.

```powershell
npm test
npm run build
```

Tests cover frontend validation, consent, API submission/errors, UI state and backend routes with an injected fake OpenAI client. No paid requests are made. `npm run build` builds the frontend; `npm run dev` runs both local services. Deployment, authentication and public-service rate limiting are outside this local MVP; the backend binds to loopback only.

## Illustrative style photos

Bundled stock photos are style references, not generated results or endorsements. Sources are in `public/photos/SOURCES.txt`, under the Unsplash license: https://unsplash.com/license . They are served locally; actual results always come from OpenAI.

Official image API reference: https://developers.openai.com/api/reference/resources/images/methods/edit
