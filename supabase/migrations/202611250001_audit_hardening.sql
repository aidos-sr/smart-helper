-- Apply after the two initial migrations. All cost/lease decisions are serialized in Postgres.
begin;
alter table public.study_materials add column folder text not null default '' check(char_length(folder)<=80),add column tags text[]not null default '{}'check(cardinality(tags)<=12 and char_length(array_to_string(tags,','))<=360);
create index study_materials_tags_idx on public.study_materials using gin(tags);
create or replace function public.enforce_owner_storage() returns trigger language plpgsql security definer set search_path='' as $$
declare n bigint; bytes bigint;
begin
  if tg_op='UPDATE' and old.user_id<>new.user_id then raise exception 'OWNER_IMMUTABLE';end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,104));
  select count(*),coalesce(sum(octet_length(payload::text)),0) into n,bytes from (
    select to_jsonb(c)as payload from public.chats c where user_id=new.user_id
    union all select to_jsonb(m)from public.study_materials m where user_id=new.user_id
  ) x;
  if n>500 or bytes>20000000 then raise exception 'USER_STORAGE_QUOTA' using errcode='23514';end if;
  return new;
end;$$;
create trigger chats_storage after insert or update on public.chats for each row execute function public.enforce_owner_storage();
create trigger materials_storage after insert or update on public.study_materials for each row execute function public.enforce_owner_storage();

create table public.progress_events(id uuid primary key,user_id uuid not null references auth.users on delete cascade,created_at timestamptz not null default now());
alter table public.progress_events enable row level security;
revoke all on public.progress_events from public,anon,authenticated;
grant all on public.progress_events to service_role;
revoke insert,update,delete on public.progress from authenticated;
create or replace function public.merge_progress_events(p_events jsonb,p_baseline jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); s jsonb; x integer; e jsonb; k text; inserted integer; d text;
begin
 if uid is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>1000 or octet_length(p_events::text)>200000 then raise exception 'INVALID_EVENTS';end if;
 insert into public.progress(user_id)values(uid)on conflict do nothing;
 select stats,xp into s,x from public.progress where user_id=uid for update;
 if (select count(*) from public.progress_events where user_id=uid)+jsonb_array_length(p_events)>100000 then raise exception 'PROGRESS_EVENT_LIMIT';end if;
 -- Monotonic migration floor; never replace a newer server value with a snapshot.
 x:=greatest(x,least(100000000,greatest(0,coalesce((p_baseline->>'xp')::integer,0))));
 foreach k in array array['total','quizzes','cards','plans'] loop
   s:=jsonb_set(s,array[k],to_jsonb(greatest(coalesce((s->>k)::integer,0),least(100000000,greatest(0,coalesce((p_baseline->'stats'->>k)::integer,0))))));
 end loop;
 for e in select value from jsonb_array_elements(p_events) loop
   if e->>'date' !~ '^\d{4}-\d{2}-\d{2}$' or coalesce((e->>'xp')::integer,0) not between 0 and 20 then raise exception 'INVALID_EVENT';end if;
   insert into public.progress_events(id,user_id)values((e->>'id')::uuid,uid)on conflict do nothing;
   get diagnostics inserted=row_count;if inserted=0 then continue;end if;
   x:=least(100000000,x+coalesce((e->>'xp')::integer,0));
   k:=case e->>'type' when 'q' then 'total' when 'quiz' then 'quizzes' when 'card' then 'cards' when 'plan' then 'plans' end;
   if k is not null then s:=jsonb_set(s,array[k],to_jsonb(coalesce((s->>k)::integer,0)+1));end if;
   if e->>'type'='q' then
     d:=e->>'date';
     if d=coalesce(s->>'lastDate','') then s:=jsonb_set(s,'{today}',to_jsonb(coalesce((s->>'today')::integer,0)+1));
     elsif d>coalesce(s->>'lastDate','') then
       s:=s||jsonb_build_object('today',1,'lastDate',d,'streak',case when nullif(s->>'lastDate','')::date=d::date-1 then coalesce((s->>'streak')::integer,0)+1 else 1 end);
     end if;
   end if;
 end loop;
 update public.progress set stats=s,xp=x,updated_at=now()where user_id=uid;
 return jsonb_build_object('stats',s,'xp',x);
end;$$;
revoke all on function public.merge_progress_events(jsonb,jsonb) from public,anon;
grant execute on function public.merge_progress_events(jsonb,jsonb) to authenticated;

create table public.ai_control(key text primary key,window_key text not null,count integer not null default 0,cost numeric not null default 0);
create table public.ai_jobs(
 id uuid primary key,user_id uuid not null references auth.users on delete cascade,request_hash text not null,task text not null,
 params jsonb not null check(octet_length(params::text)<=100000),status text not null default 'running' check(status in('running','partial','complete','error')),
 parts jsonb not null default '[]' check(octet_length(parts::text)<=200000),result jsonb check(octet_length(result::text)<=200000),
 lease_until timestamptz not null default now()+interval '180 seconds',expires_at timestamptz not null default now()+interval '7 days',updated_at timestamptz not null default now());
create index ai_jobs_owner_idx on public.ai_jobs(user_id,updated_at desc);
create index ai_jobs_expiry_idx on public.ai_jobs(expires_at);
create index ai_jobs_running_idx on public.ai_jobs(lease_until,user_id)where status='running';
create table public.ai_model_health(model text primary key,cooldown_until timestamptz not null,reason text not null);
alter table public.ai_control enable row level security;
alter table public.ai_jobs enable row level security;
alter table public.ai_model_health enable row level security;
revoke all on public.ai_control,public.ai_jobs,public.ai_model_health from public,anon,authenticated;
grant all on public.ai_control,public.ai_jobs,public.ai_model_health to service_role;
grant select on public.ai_jobs to authenticated;
create policy jobs_owner on public.ai_jobs for select to authenticated using((select auth.uid())=user_id);
create or replace function public.reserve_ai_attempt(p_user_id uuid,p_channel text,p_global_limit integer,p_user_limit integer)returns jsonb language plpgsql security definer set search_path='' as $$
declare key_name text; window_name text; item public.ai_control; cap integer;
begin
 if p_user_id is null or p_global_limit not between 1 and 100000 or p_user_limit not between 1 and 1000 or p_channel not in('ai','search','provider') then raise exception 'INVALID_LIMIT';end if;
 perform pg_advisory_xact_lock(94281041);
 for key_name,window_name,cap in select 'global-attempts',to_char(now()at time zone'UTC','YYYY-MM-DD'),p_global_limit union all select p_channel||':'||p_user_id,to_char(now()at time zone'UTC','YYYY-MM-DD HH24:MI'),p_user_limit loop
  insert into public.ai_control(key,window_key)values(key_name,window_name)on conflict do nothing;
  select * into item from public.ai_control where key=key_name for update;
  if item.window_key<>window_name then update public.ai_control set window_key=window_name,count=0,cost=0 where key=key_name;item.count:=0;end if;
  if item.count>=cap then return jsonb_build_object('allowed',false,'reason','ATTEMPT_LIMIT','retryAfter',case when key_name='global-attempts' then greatest(1,extract(epoch from(date_trunc('day',now()at time zone'UTC')+interval'1 day'-(now()at time zone'UTC'))))::integer else 60 end);end if;
 end loop;
 update public.ai_control set count=count+1 where key in('global-attempts',p_channel||':'||p_user_id);
 return jsonb_build_object('allowed',true);
end;$$;
create or replace function public.reserve_ai_cost(p_user_id uuid,p_amount numeric,p_user_budget numeric,p_global_budget numeric)returns boolean language plpgsql security definer set search_path='' as $$
declare key_name text; cap numeric; item public.ai_control; w text:=to_char(now()at time zone'UTC','YYYY-MM-DD');
begin
 if p_amount<0 or p_amount>10 or p_user_budget<0 or p_global_budget<0 then raise exception 'INVALID_BUDGET';end if;
 perform pg_advisory_xact_lock(94281042);
 for key_name,cap in select 'cost-global',p_global_budget union all select 'cost:'||p_user_id,p_user_budget loop
  insert into public.ai_control(key,window_key)values(key_name,w)on conflict do nothing;
  select * into item from public.ai_control where key=key_name for update;
  if item.window_key<>w then update public.ai_control set window_key=w,count=0,cost=0 where key=key_name;item.cost:=0;end if;
  if item.cost+p_amount>cap then return false;end if;
 end loop;
 update public.ai_control set cost=cost+p_amount where key in('cost-global','cost:'||p_user_id);
 return true;
end;$$;
create or replace function public.claim_ai_job(p_user_id uuid,p_id uuid,p_hash text,p_task text,p_params jsonb,p_project_limit integer)returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.ai_jobs;
begin
 perform pg_advisory_xact_lock(94281043);
 delete from public.ai_jobs where expires_at<now();
 update public.ai_jobs set status='partial' where status='running'and lease_until<now();
 select * into job from public.ai_jobs where id=p_id for update;
 if found then
  if job.user_id<>p_user_id or job.request_hash<>p_hash then return jsonb_build_object('error','OPERATION_CONFLICT');end if;
  if job.status='complete' then return jsonb_build_object('cached',job.result);end if;
  if job.status='running' then return jsonb_build_object('error','JOB_ACTIVE');end if;
 end if;
 if not found then
   select * into job from public.ai_jobs where user_id=p_user_id and request_hash=p_hash and status='complete' and updated_at>now()-interval'15 minutes' order by updated_at desc limit 1;
   if found then return jsonb_build_object('cached',job.result);end if;
 end if;
 if(select count(*)from public.ai_jobs where user_id=p_user_id and status='running')>=1 or(select count(*)from public.ai_jobs where status='running')>=p_project_limit then return jsonb_build_object('error','CONCURRENCY_LIMIT');end if;
 if(select count(*)from public.ai_jobs where user_id=p_user_id)>=100 then return jsonb_build_object('error','JOB_STORAGE_LIMIT');end if;
 insert into public.ai_jobs(id,user_id,request_hash,task,params)values(p_id,p_user_id,p_hash,p_task,p_params)on conflict(id)do update set status='running',lease_until=now()+interval'180 seconds';
 return jsonb_build_object('parts',coalesce(job.parts,'[]'::jsonb));
end;$$;
revoke all on function public.reserve_ai_attempt(uuid,text,integer,integer),public.reserve_ai_cost(uuid,numeric,numeric,numeric),public.claim_ai_job(uuid,uuid,text,text,jsonb,integer),public.enforce_owner_storage() from public,anon,authenticated;
grant execute on function public.reserve_ai_attempt(uuid,text,integer,integer),public.reserve_ai_cost(uuid,numeric,numeric,numeric),public.claim_ai_job(uuid,uuid,text,text,jsonb,integer) to service_role;
create or replace function public.clean_user_control()returns trigger language plpgsql security definer set search_path='' as $$
begin delete from public.ai_control where key in('ai:'||old.id,'search:'||old.id,'provider:'||old.id,'cost:'||old.id);return old;end;$$;
revoke all on function public.clean_user_control()from public,anon,authenticated;
create trigger clean_user_control after delete on auth.users for each row execute function public.clean_user_control();
commit;
