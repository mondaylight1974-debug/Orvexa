-- Orvexa AI GitHub connection storage
-- Run this in Supabase SQL Editor before deploying the github-connect Edge Function.
create table if not exists public.github_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  github_user_id bigint not null,
  github_login text not null,
  access_token text not null,
  token_type text not null default 'bearer',
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now()
);
create table if not exists public.github_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);
alter table public.github_connections enable row level security;
alter table public.github_oauth_states enable row level security;
-- No client-side policies: only the Edge Function service-role client may access these tables.
revoke all on public.github_connections from anon, authenticated;
revoke all on public.github_oauth_states from anon, authenticated;
grant all on public.github_connections to service_role;
grant all on public.github_oauth_states to service_role;
