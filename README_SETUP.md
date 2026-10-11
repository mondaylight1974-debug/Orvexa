# Smart AI — connected backend starter

This bundle keeps the existing dark black/purple/blue interface and adds a real backend integration path. The main interface is hosted by GitHub Pages; the AI Edge Function must be deployed separately to Supabase. It is **not yet a deployed or fully tested production app**: you must create your own service accounts, add secrets, deploy the functions, and test them. Never put your OpenAI API key or Supabase service-role key in `index.html`.

## Included
- `index.html` — mobile-first UI; Supabase email sign-up/sign-in wiring and secure AI endpoint call.
- `manifest.json`, `service-worker.js` — web app metadata/cache.
- `supabase/schema.sql` — user-scoped chat-message and opt-in preference tables with row-level security.
- `supabase/functions/smart-assistant/index.ts` — authenticated AI chat, image understanding, optional web search, saves messages.


## Do this from your Android phone

### 1. Create the online database/backend
1. Open the official Supabase website: https://supabase.com and create a project. Save its database password privately.
2. Open **SQL Editor** in your project, paste all of `supabase/schema.sql`, and run it. If sign-up displays “Database error saving new user”, run `supabase/repair_auth.sql` too.
3. Open **Project Settings → API** and copy the Project URL and publishable/anon key.
4. In `index.html`, The `index.html` in this personalized bundle is already filled with your Supabase Project URL and publishable key. Do not replace them unless you create a different Supabase project. This public key can be in the browser; never use the service-role key here.
5. In **Authentication → Providers**, enable Email. Choose whether email confirmation is required and configure the site URL/redirect URLs for your hosted app.

### 2. Configure the AI provider
1. Create an API account at https://platform.openai.com/ and add billing if required. ChatGPT subscription and API billing are separate.
2. Create an API key in the provider dashboard. Keep it private.
3. In Supabase **Edge Functions → Secrets** (or the CLI secrets command), set `OPENAI_API_KEY` to that key. Optional secrets: `OPENAI_MODEL` (defaults to `gpt-5-mini`) and `OPENAI_IMAGE_MODEL` (defaults to `gpt-image-1`). Model availability and cost depend on your API account.

### 3. Deploy the functions
Supabase's dashboard or CLI can deploy Edge Functions. The project files are in `supabase/functions/`.
- Deploy `smart-assistant` from `supabase/functions/smart-assistant/index.ts`.

- Ensure the functions have `SUPABASE_URL` and `SUPABASE_ANON_KEY` environment values (Supabase provides these to functions in standard projects) plus `OPENAI_API_KEY`.

Official guides: https://supabase.com/docs/guides/functions and https://supabase.com/docs/guides/auth

### 4. Host the app over HTTPS
Upload `index.html`, `manifest.json`, and `service-worker.js` to a static HTTPS host. Open the hosted URL on your phone and test sign-up, email confirmation, sign-in, chat, and image upload. Browsers require HTTPS for many microphone/PWA capabilities.

## Important current limits
- The main chat endpoint is wired to a real AI backend after you configure it. Image understanding uses an image selected in the chat and a vision-capable model.
- Image generation has a deployed endpoint scaffold but the current UI still needs a generator screen/button wired to that endpoint.
- Browser speech input and speech output depend on device/browser support; this is not yet a continuous real-time voice agent.
- Database tables are included, but chat history UI currently primarily uses device-local history. Cloud history loading/sync still needs to be added.
- The memory table is opt-in-ready, but preference controls and memory retrieval/save logic are not wired yet.
- Subscription payments, premium enforcement, account deletion/privacy workflow, rate limits, abuse controls, and full security testing are not included. Do not charge users or publicly launch before implementing and testing these.
- This is not an APK yet. After HTTPS hosting works, package the hosted app with a trusted Android wrapper/cloud build. Test the resulting APK on your phone. A separate iOS build is needed for iPhone distribution.

## Security checklist before public release
- Keep all provider secrets server-side.
- Add rate limits and per-user usage/cost limits.
- Verify authentication and RLS with two different test accounts.
- Configure allowed origins/CORS to your actual app domain instead of `*`.
- Add privacy policy, account/data deletion, user consent for memory, and safety/error monitoring.
- Test model and image-generation costs before enabling unrestricted use.


## Your project details
- Project URL: `https://ruczzcnrkgnoftghoapr.supabase.co`
- The browser app contains only the publishable key you supplied. Never add a service-role key or OpenAI API key to the HTML.
- The database SQL you already ran creates `profiles`, `conversations`, `messages`, and `user_preferences`. The chat function saves to `conversations` and `messages`. The correct deployable function source is `supabase/functions/smart-assistant/index.ts`; the root `index.ts` is retained as a legacy copy.
