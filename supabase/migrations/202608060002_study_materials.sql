-- Smart Helper: saved AI-generated study materials owned by each user.

create table if not exists public.study_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('flashcards', 'quiz', 'planner')),
  title text not null check (char_length(title) between 1 and 160),
  content jsonb not null
    check (jsonb_typeof(content) = 'object')
    check (octet_length(content::text) <= 200000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists study_materials_user_kind_updated_idx
  on public.study_materials (user_id, kind, updated_at desc);

alter table public.study_materials enable row level security;

revoke all on public.study_materials from anon;
grant select, insert, update, delete on public.study_materials to authenticated;
grant all on public.study_materials to service_role;

drop policy if exists "Users can read their own study materials" on public.study_materials;
create policy "Users can read their own study materials"
  on public.study_materials for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own study materials" on public.study_materials;
create policy "Users can create their own study materials"
  on public.study_materials for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own study materials" on public.study_materials;
create policy "Users can update their own study materials"
  on public.study_materials for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own study materials" on public.study_materials;
create policy "Users can delete their own study materials"
  on public.study_materials for delete to authenticated
  using ((select auth.uid()) = user_id);
