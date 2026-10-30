-- Additive delivery schema. Existing users, drafts and company settings are retained.
create table public.mr2_delivery_config (
 id integer primary key check(id=1), encrypted_key text, webhook_hash text,
 webhook_id bigint, verified_sender text, enabled boolean not null default false,
 daily_limit integer not null default 300 check(daily_limit between 1 and 300),
 verified_at timestamptz, worker_hash text, last_worker_at timestamptz,
 last_error text, updated_at timestamptz not null default now()
);
insert into public.mr2_delivery_config(id) values(1);
create table public.mr2_suppressions(email text primary key, reason text not null, created_at timestamptz not null default now());
create table public.mr2_runs(id uuid primary key, campaign_id text, name text not null, created_by uuid references public.mr2_users(id), created_at timestamptz not null default now(), due_at timestamptz not null, test boolean not null default false);
create table public.mr2_jobs(
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.mr2_runs(id),
 email text not null, name text not null default '', campaign jsonb not null, identity jsonb not null,
 sequence_id text, step integer not null default 0, due_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','sending','accepted','delivered','failed','skipped','uncertain','cancelled')),
 provider_id text, error text, claimed_at timestamptz, accepted_at timestamptz, delivered_at timestamptz,
 opened_at timestamptz, clicked_at timestamptz, created_at timestamptz not null default now(),
 unique(run_id,email,step)
);
create index mr2_jobs_due on public.mr2_jobs(due_at) where status='pending';
create index mr2_jobs_provider on public.mr2_jobs(provider_id) where provider_id is not null;
create index mr2_jobs_email on public.mr2_jobs(email);
create index mr2_jobs_run on public.mr2_jobs(run_id);
create index mr2_runs_actor on public.mr2_runs(created_by);
create table public.mr2_daily(day date primary key, reserved integer not null default 0);
create table public.mr2_automations(sequence_id text primary key, enabled boolean not null default false, definition jsonb, identity jsonb, created_by uuid references public.mr2_users(id), activated_at timestamptz not null default now());
create index mr2_automations_actor on public.mr2_automations(created_by);
create table public.mr2_enrollments(sequence_id text not null references public.mr2_automations(sequence_id),email text not null,created_at timestamptz not null default now(),primary key(sequence_id,email));
create table public.mr2_unsubscribe_tokens(token_hash text primary key,email text not null,created_at timestamptz not null default now());
create index mr2_unsubscribe_tokens_email on public.mr2_unsubscribe_tokens(email);

create function public.mr2_queue_campaign(p_run uuid,p_campaign text,p_due timestamptz,p_actor uuid,p_test boolean default false) returns integer language plpgsql security invoker set search_path='' as $$
declare w jsonb;c jsonb;who public.mr2_users; n integer;
begin
 perform pg_advisory_xact_lock(72402501);
 select * into who from public.mr2_users where id=p_actor and active and role='admin';
 if who.id is null then raise exception 'Admin access required'; end if;
 if exists(select 1 from public.mr2_runs where id=p_run) then return (select count(*) from public.mr2_jobs where run_id=p_run); end if;
 select data into w from public.mr2_config where id=1;
 select value into c from jsonb_array_elements(w->'campaigns') where value->>'id'=p_campaign;
 if c is null or length(trim(c->>'subject'))=0 or length(trim(c->>'body'))=0 then raise exception 'Save a subject and message first'; end if;
 if not exists(select 1 from public.mr2_delivery_config where id=1 and enabled and encrypted_key is not null and webhook_id is not null and verified_sender=lower(w->'settings'->>'from')) or length(trim(w->'settings'->>'address'))<5 then raise exception 'Connect Brevo and verify sender and postal address first'; end if;
 if p_due<now()-interval '1 minute' or p_due>now()+interval '365 days' then raise exception 'Invalid sending date'; end if;
 if (select count(*) from public.mr2_jobs where status in ('pending','sending'))>20000 then raise exception 'Finish or cancel existing queued emails first'; end if;
 insert into public.mr2_runs values(p_run,p_campaign,c->>'name',p_actor,now(),p_due,p_test);
 if p_test then
 insert into public.mr2_jobs(run_id,email,name,campaign,identity,due_at) values(p_run,who.email,who.name,c,w->'settings',p_due);
 else
 insert into public.mr2_jobs(run_id,email,name,campaign,identity,due_at)
 select p_run,lower(value->>'email'),coalesce(value->>'name',''),c,w->'settings',p_due
 from jsonb_array_elements(w->'contacts')
 where value->>'status'='Subscribed' and (c->>'segment'='All subscribers' or c->>'segment'=any(regexp_split_to_array(value->>'tags','\s*,\s*')))
 and not exists(select 1 from public.mr2_suppressions s where s.email=lower(value->>'email'))
 on conflict do nothing;
 end if;
 get diagnostics n=row_count;
 if n=0 then raise exception 'No eligible subscribed recipients'; end if;
 return n;
end $$;

create function public.mr2_claim_jobs() returns setof public.mr2_jobs language plpgsql security invoker set search_path='' as $$
declare remaining integer; lim integer;
begin
 perform pg_advisory_xact_lock(72402502);
 update public.mr2_delivery_config set last_worker_at=now() where id=1;
 update public.mr2_jobs set status='uncertain',error='Delivery result unknown. Not retried to prevent duplicates.' where status='sending' and claimed_at<now()-interval '5 minutes';
 select daily_limit into lim from public.mr2_delivery_config where id=1 and enabled and encrypted_key is not null and webhook_id is not null;
 if lim is null then return; end if;
 insert into public.mr2_daily(day) values((now() at time zone 'UTC')::date) on conflict do nothing;
 select greatest(0,lim-reserved) into remaining from public.mr2_daily where day=(now() at time zone 'UTC')::date for update;
 remaining=least(remaining,10);
 update public.mr2_jobs j set status='skipped',error='A previous sequence step did not complete'
 where j.status='pending' and j.sequence_id is not null and j.step>0 and exists(
 select 1 from public.mr2_jobs prev where prev.run_id=j.run_id and prev.email=j.email and prev.step=j.step-1 and prev.status in ('failed','uncertain','skipped','cancelled'));

 return query with chosen as(select candidate.id from public.mr2_jobs candidate where candidate.status='pending' and candidate.due_at<=now()
 and (candidate.sequence_id is null or candidate.step=0 or exists(
 select 1 from public.mr2_jobs prev where prev.run_id=candidate.run_id and prev.email=candidate.email and prev.step=candidate.step-1
 and prev.status in ('accepted','delivered') and prev.accepted_at+make_interval(days=>(candidate.campaign->>'days')::integer)<=now()))
 order by candidate.due_at,candidate.run_id,candidate.step,candidate.id limit remaining for update skip locked)
 update public.mr2_jobs j set status='sending',claimed_at=now() from chosen where j.id=chosen.id returning j.*;
 get diagnostics remaining=row_count;
 update public.mr2_daily set reserved=reserved+remaining where day=(now() at time zone 'UTC')::date;
end $$;

create function public.mr2_enroll_sequence(p_sequence text,p_baseline boolean default false,p_manual boolean default false) returns integer language plpgsql security invoker set search_path='' as $$
declare w jsonb;s jsonb;identity jsonb;c jsonb;st jsonb;run uuid;delay integer;idx integer;n integer=0;
begin
 perform pg_advisory_xact_lock(72402503);
 if not exists(select 1 from public.mr2_automations where sequence_id=p_sequence and enabled) then return 0; end if;
 select data into w from public.mr2_config where id=1;
 select definition,a.identity into s,identity from public.mr2_automations a where sequence_id=p_sequence;
 if s is null or (not p_manual and s->>'trigger'='Manual enrolment') then return 0; end if;
 if jsonb_array_length(s->'steps')>20 then raise exception 'Maximum 20 emails per active sequence'; end if;
 for c in select value from jsonb_array_elements(w->'contacts') where value->>'status'='Subscribed' loop
  if s->>'trigger'='Tag added' and not(coalesce(s->>'triggerTag','')<>'' and s->>'triggerTag'=any(regexp_split_to_array(c->>'tags','\s*,\s*'))) then continue; end if;
  if exists(select 1 from public.mr2_suppressions where email=lower(c->>'email')) then continue; end if;
  insert into public.mr2_enrollments values(p_sequence,lower(c->>'email'),now()) on conflict do nothing;
  if not found or p_baseline then continue; end if;
  if (select count(*) from public.mr2_jobs where status='pending')>20000 then raise exception 'Queue limit reached'; end if;
  run=gen_random_uuid();delay=0;idx=0;
  insert into public.mr2_runs(id,name,due_at,created_by) values(run,s->>'name',now(),(select created_by from public.mr2_automations where sequence_id=p_sequence));
  for st in select value from jsonb_array_elements(s->'steps') loop
   delay=delay+(st->>'days')::integer;
   insert into public.mr2_jobs(run_id,email,name,campaign,identity,sequence_id,step,due_at)
   values(run,lower(c->>'email'),coalesce(c->>'name',''),st,identity,p_sequence,idx,now()+make_interval(days=>delay));
   idx=idx+1;
  end loop;
  n=n+1;
 end loop;
 return n;
end $$;

create function public.mr2_suppress(p_email text,p_reason text) returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.mr2_suppressions(email,reason) values(lower(p_email),p_reason) on conflict(email) do update set reason=case when mr2_suppressions.reason in ('spam','hard_bounce','blocked','invalid') then mr2_suppressions.reason else excluded.reason end;
 update public.mr2_jobs set status='skipped',error='Recipient unsubscribed or suppressed' where email=lower(p_email) and status='pending';
end $$;

-- The API is custom company authentication. Only its service role can access delivery data.
alter table public.mr2_delivery_config enable row level security;
alter table public.mr2_suppressions enable row level security;
alter table public.mr2_runs enable row level security;
alter table public.mr2_jobs enable row level security;
alter table public.mr2_daily enable row level security;
alter table public.mr2_automations enable row level security;
alter table public.mr2_enrollments enable row level security;
alter table public.mr2_unsubscribe_tokens enable row level security;
revoke all on public.mr2_delivery_config,public.mr2_suppressions,public.mr2_runs,public.mr2_jobs,public.mr2_daily,public.mr2_automations,public.mr2_enrollments,public.mr2_unsubscribe_tokens from public,anon,authenticated;
grant all on public.mr2_delivery_config,public.mr2_suppressions,public.mr2_runs,public.mr2_jobs,public.mr2_daily,public.mr2_automations,public.mr2_enrollments,public.mr2_unsubscribe_tokens to service_role;
revoke all on function public.mr2_queue_campaign(uuid,text,timestamptz,uuid,boolean),public.mr2_claim_jobs(),public.mr2_enroll_sequence(text,boolean,boolean),public.mr2_suppress(text,text) from public,anon,authenticated;
grant execute on function public.mr2_queue_campaign(uuid,text,timestamptz,uuid,boolean),public.mr2_claim_jobs(),public.mr2_enroll_sequence(text,boolean,boolean),public.mr2_suppress(text,text) to service_role;

create function public.mr2_delivery_totals() returns jsonb language sql security invoker set search_path='' as $$
select jsonb_build_object('accepted',count(*) filter(where status in ('accepted','delivered')),'delivered',count(*) filter(where status='delivered'),'pending',count(*) filter(where status='pending'),'failed',count(*) filter(where status in ('failed','uncertain')),'opened',count(*) filter(where opened_at is not null),'clicked',count(*) filter(where clicked_at is not null)) from public.mr2_jobs $$;
create function public.mr2_delivery_runs() returns jsonb language sql security invoker set search_path='' as $$
select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc),'[]'::jsonb) from (
 select r.id,r.name,r.campaign_id,r.created_at,r.due_at,r.test,count(j.id) as total,
 count(j.id) filter(where j.status='pending') as pending,count(j.id) filter(where j.status in ('accepted','delivered')) as accepted,
 count(j.id) filter(where j.status='delivered') as delivered,count(j.id) filter(where j.status in ('failed','uncertain')) as failed,
 count(j.id) filter(where j.status in ('cancelled','skipped')) as skipped,
 count(j.id) filter(where j.opened_at is not null) as opened,count(j.id) filter(where j.clicked_at is not null) as clicked
 from public.mr2_runs r left join public.mr2_jobs j on r.id=j.run_id group by r.id order by r.created_at desc limit 100
) x $$;
revoke all on function public.mr2_delivery_totals(),public.mr2_delivery_runs() from public,anon,authenticated;
grant execute on function public.mr2_delivery_totals(),public.mr2_delivery_runs() to service_role;
