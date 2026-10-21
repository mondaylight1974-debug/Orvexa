# Orvexa AI — GitHub connection setup

The GitHub connection code is prepared, but it will not connect until the database SQL and Edge Function are deployed and the GitHub OAuth credentials are added. Never put the GitHub client secret, service-role key, or access tokens in `index.html`.

## 1. Create the database tables
In Supabase, open **SQL Editor**, paste the complete contents of `supabase/github_integration.sql`, and run it.

## 2. Register a GitHub OAuth App
In GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**.
- Application name: `Orvexa AI`
- Homepage URL: `https://mondaylight1974-debug.github.io/Orvexa/`
- Authorization callback URL: `https://ruczzcnrkgnoftghoapr.supabase.co/functions/v1/github-connect`

Create the app and keep its Client ID and Client Secret private. The app requests `read:user`, `user:email`, and `repo` scopes; the `repo` scope can allow access to private repositories, so only authorize it on a GitHub account you control and trust.

## 3. Add secrets in Supabase
Open **Project Settings → Edge Functions → Secrets** (the exact menu wording can vary) and add:
- `GITHUB_CLIENT_ID` — the OAuth App Client ID
- `GITHUB_CLIENT_SECRET` — the OAuth App Client Secret
- `SUPABASE_SERVICE_ROLE_KEY` — the project's service-role key, stored only as a server-side secret

The Supabase function also uses the project's `SUPABASE_URL` and `SUPABASE_ANON_KEY` environment variables. Do not paste any secret into public GitHub files or chat messages.

## 4. Deploy the Edge Function
Deploy `supabase/functions/github-connect/index.ts` as the function named `github-connect`. Because GitHub's callback arrives without a Supabase user JWT, configure this function to allow the callback request through the platform JWT gate (for the Supabase CLI, deploy with `--no-verify-jwt`). The function itself checks the signed-in Orvexa user for its POST actions and validates a short-lived, one-time OAuth state on the callback. Do not disable the checks inside the function.

## 5. Test
1. Open Orvexa AI and sign in.
2. Open **Profile & settings → Connected development tools**.
3. Tap **Connect GitHub** and authorize the requested access on GitHub.
4. Return to Orvexa and tap **Refresh repositories**.
5. Verify that only repositories accessible to the authorized GitHub account are listed. Tap **Disconnect** to remove the stored connection.

## Current limits
This first integration lists repositories and establishes the secure connection. It does not yet edit files, create commits, open pull requests, or deploy websites. Those capabilities should be added separately with confirmation before any write/publish action. OAuth tokens are stored in the protected Supabase table and must never be returned to the browser.
