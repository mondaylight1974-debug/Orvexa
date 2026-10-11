-- Run in Supabase SQL Editor. Auth is managed by Supabase Auth.
create extension if not exists pgcrypto;
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_user_created_idx on public.chat_messages(user_id, created_at desc);
alter table public.chat_messages enable row level security;
drop policy if exists "Users can read own messages" on public.chat_messages;
create policy "Users can read own messages" on public.chat_messages for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own messages" on public.chat_messages;
create policy "Users can insert own messages" on public.chat_messages for insert with check (auth.uid() = user_id);
drop policy if exists "Users can delete own messages" on public.chat_messages;
create policy "Users can delete own messages" on public.chat_messages for delete using (auth.uid() = user_id);
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  memory_enabled boolean not null default false,
  memory_text text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.user_preferences enable row level security;
drop policy if exists "Users manage own preferences" on public.user_preferences;
create policy "Users manage own preferences" on public.user_preferences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
