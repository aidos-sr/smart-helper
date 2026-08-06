-- Smart Helper: user-owned chat/progress data and server-only AI quotas.

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  messages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(messages) = 'array')
    check (jsonb_array_length(messages) <= 40)
    check (octet_length(messages::text) <= 100000),
  updated_at timestamptz not null default now()
);

create index if not exists chats_user_updated_idx
  on public.chats (user_id, updated_at desc);

create table if not exists public.progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stats jsonb not null default '{}'::jsonb
    check (jsonb_typeof(stats) = 'object')
    check (octet_length(stats::text) <= 20000),
  xp integer not null default 0 check (xp between 0 and 100000000),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  day_key date not null,
  day_count integer not null default 0 check (day_count >= 0),
  minute_key bigint not null,
  minute_count integer not null default 0 check (minute_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.chats enable row level security;
alter table public.progress enable row level security;
alter table public.ai_usage enable row level security;

revoke all on public.chats, public.progress, public.ai_usage from anon;
revoke all on public.ai_usage from authenticated;
grant select, insert, update, delete on public.chats, public.progress to authenticated;
grant all on public.chats, public.progress, public.ai_usage to service_role;

drop policy if exists "Users can read their own chats" on public.chats;
create policy "Users can read their own chats"
  on public.chats for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own chats" on public.chats;
create policy "Users can create their own chats"
  on public.chats for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own chats" on public.chats;
create policy "Users can update their own chats"
  on public.chats for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own chats" on public.chats;
create policy "Users can delete their own chats"
  on public.chats for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own progress" on public.progress;
create policy "Users can read their own progress"
  on public.progress for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own progress" on public.progress;
create policy "Users can create their own progress"
  on public.progress for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own progress" on public.progress;
create policy "Users can update their own progress"
  on public.progress for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.consume_ai_quota(
  p_user_id uuid,
  p_minute_limit integer,
  p_daily_limit integer
)
returns table (allowed boolean, minute_remaining integer, daily_remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (current_timestamp at time zone 'UTC')::date;
  v_minute bigint := floor(extract(epoch from current_timestamp) / 60)::bigint;
  v_usage public.ai_usage%rowtype;
begin
  if p_user_id is null
     or p_minute_limit not between 1 and 100
     or p_daily_limit not between 1 and 10000 then
    raise exception 'Invalid quota parameters';
  end if;

  insert into public.ai_usage (user_id, day_key, day_count, minute_key, minute_count)
  values (p_user_id, v_day, 0, v_minute, 0)
  on conflict (user_id) do nothing;

  select * into v_usage
  from public.ai_usage
  where user_id = p_user_id
  for update;

  if v_usage.day_key <> v_day then
    v_usage.day_key := v_day;
    v_usage.day_count := 0;
  end if;
  if v_usage.minute_key <> v_minute then
    v_usage.minute_key := v_minute;
    v_usage.minute_count := 0;
  end if;

  if v_usage.day_count >= p_daily_limit or v_usage.minute_count >= p_minute_limit then
    update public.ai_usage
      set day_key = v_usage.day_key,
          day_count = v_usage.day_count,
          minute_key = v_usage.minute_key,
          minute_count = v_usage.minute_count,
          updated_at = now()
      where user_id = p_user_id;

    return query select false,
      greatest(0, p_minute_limit - v_usage.minute_count),
      greatest(0, p_daily_limit - v_usage.day_count);
    return;
  end if;

  v_usage.day_count := v_usage.day_count + 1;
  v_usage.minute_count := v_usage.minute_count + 1;

  update public.ai_usage
    set day_key = v_usage.day_key,
        day_count = v_usage.day_count,
        minute_key = v_usage.minute_key,
        minute_count = v_usage.minute_count,
        updated_at = now()
    where user_id = p_user_id;

  return query select true,
    greatest(0, p_minute_limit - v_usage.minute_count),
    greatest(0, p_daily_limit - v_usage.day_count);
end;
$$;

revoke all on function public.consume_ai_quota(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, integer, integer)
  to service_role;
