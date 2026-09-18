create table if not exists public.builds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled',
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists builds_user_id_idx on public.builds (user_id);
create index if not exists builds_created_at_idx on public.builds (created_at desc);

alter table public.builds enable row level security;

create policy "Users can read own builds"
  on public.builds for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own builds"
  on public.builds for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own builds"
  on public.builds for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own builds"
  on public.builds for delete
  to authenticated
  using (auth.uid() = user_id);
