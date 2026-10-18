import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const siteUrl = 'https://mondaylight1974-debug.github.io/Smartt/';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const clientId = Deno.env.get('GITHUB_CLIENT_ID');
  const clientSecret = Deno.env.get('GITHUB_CLIENT_SECRET');
  if (!supabaseUrl || !anonKey || !serviceKey || !clientId || !clientSecret) {
    return json({ error: 'GitHub integration backend is not configured. Add the required Supabase and GitHub secrets.' }, 503);
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // GitHub redirects back to this function URL after the user authorizes the app.
  if (req.method === 'GET') {
    const incoming = new URL(req.url);
    const code = incoming.searchParams.get('code');
    const state = incoming.searchParams.get('state');
    const githubError = incoming.searchParams.get('error');
    if (githubError) return Response.redirect(siteUrl + '?github=cancelled', 302);
    if (!code || !state) return Response.redirect(siteUrl + '?github=error', 302);
    const { data: pending, error: stateError } = await admin.from('github_oauth_states')
      .select('user_id,expires_at').eq('state', state).maybeSingle();
    await admin.from('github_oauth_states').delete().eq('state', state);
    if (stateError || !pending || new Date(pending.expires_at).getTime() < Date.now()) {
      return Response.redirect(siteUrl + '?github=state_error', 302);
    }
    try {
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenData.access_token) {
        console.error('GitHub token exchange failed:', tokenData.error || tokenResponse.status);
        return Response.redirect(siteUrl + '?github=token_error', 302);
      }
      const accessToken = String(tokenData.access_token);
      const userResponse = await fetch('https://api.github.com/user', {
        headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      });
      const githubUser = await userResponse.json();
      if (!userResponse.ok || !githubUser.id || !githubUser.login) {
        return Response.redirect(siteUrl + '?github=user_error', 302);
      }
      const scopes = String(tokenData.scope || '').split(',').filter(Boolean);
      const { error: saveError } = await admin.from('github_connections').upsert({
        user_id: pending.user_id,
        github_user_id: githubUser.id,
        github_login: githubUser.login,
        access_token: accessToken,
        token_type: tokenData.token_type || 'bearer',
        scopes,
        connected_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (saveError) {
        console.error('Could not save GitHub connection:', saveError.message);
        return Response.redirect(siteUrl + '?github=save_error', 302);
      }
      return Response.redirect(siteUrl + '?github=connected', 302);
    } catch (e) {
      console.error('GitHub OAuth callback failed:', e);
      return Response.redirect(siteUrl + '?github=error', 302);
    }
  }

  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Please sign in to connect GitHub.' }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'Your Orvexa account session is invalid. Please sign in again.' }, 401);

  let body: { action?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }
  const action = String(body.action || '');
  if (action === 'start') {
    const stateBytes = crypto.getRandomValues(new Uint8Array(32));
    const state = Array.from(stateBytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const { error } = await admin.from('github_oauth_states').insert({
      state, user_id: user.id, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (error) {
      console.error('Could not create GitHub OAuth state:', error.message);
      return json({ error: 'Could not start GitHub authorization. Check that the SQL setup has been run.' }, 500);
    }
    const callback = supabaseUrl + '/functions/v1/github-connect';
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', callback);
    url.searchParams.set('scope', 'read:user user:email repo');
    url.searchParams.set('state', state);
    return json({ url: url.toString() });
  }
  if (action === 'status') {
    const { data, error } = await admin.from('github_connections')
      .select('github_login,scopes,connected_at').eq('user_id', user.id).maybeSingle();
    if (error) return json({ error: 'Could not check GitHub connection.' }, 500);
    return json({ connected: Boolean(data), login: data?.github_login || null, scopes: data?.scopes || [], connected_at: data?.connected_at || null });
  }
  if (action === 'repos') {
    const { data: connection, error } = await admin.from('github_connections')
      .select('github_login,access_token').eq('user_id', user.id).maybeSingle();
    if (error) return json({ error: 'Could not read GitHub connection.' }, 500);
    if (!connection) return json({ connected: false, repos: [] });
    const response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=50&visibility=all', {
      headers: { Authorization: 'Bearer ' + connection.access_token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (response.status === 401) {
      await admin.from('github_connections').delete().eq('user_id', user.id);
      return json({ connected: false, error: 'GitHub authorization expired. Connect again.' }, 401);
    }
    if (!response.ok) return json({ error: 'GitHub could not return repositories. Please reconnect and try again.' }, 502);
    const repos = await response.json();
    return json({ connected: true, login: connection.github_login, repos: Array.isArray(repos) ? repos.map((r: any) => ({
      id: r.id, name: r.name, full_name: r.full_name, description: r.description,
      html_url: r.html_url, private: r.private, default_branch: r.default_branch,
      permissions: r.permissions ? { pull: Boolean(r.permissions.pull), push: Boolean(r.permissions.push), admin: Boolean(r.permissions.admin) } : undefined,
    })) : [] });
  }
  if (action === 'disconnect') {
    const { error } = await admin.from('github_connections').delete().eq('user_id', user.id);
    if (error) return json({ error: 'Could not disconnect GitHub.' }, 500);
    return json({ disconnected: true });
  }
  return json({ error: 'Unsupported action.' }, 400);
});
