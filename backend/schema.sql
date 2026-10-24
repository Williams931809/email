-- All Mailroom objects are isolated from existing application tables and Auth.
create table public.mr2_config (id integer primary key check(id=1), setup_hash text not null, bridge_hash text not null, claimed boolean not null default false, data jsonb, version bigint not null default 0);
create table public.mr2_users (id uuid primary key default gen_random_uuid(), email text not null unique check(email=lower(email)), name text not null, password_hash text not null, salt text not null, recovery_hash text, role text not null check(role in ('admin','member')), founder boolean not null default false, active boolean not null default true, created_at timestamptz not null default now());
create unique index mr2_single_founder on public.mr2_users(founder) where founder;
create table public.mr2_sessions(token_hash text primary key, user_id uuid not null references public.mr2_users(id) on delete cascade, expires_at timestamptz not null, created_at timestamptz not null default now());
create index mr2_session_user on public.mr2_sessions(user_id);
create table public.mr2_invites(token_hash text primary key, email text not null check(email=lower(email)), role text not null check(role in ('admin','member')), kind text not null check(kind in ('join','reset')), used boolean not null default false, expires_at timestamptz not null, created_by uuid not null references public.mr2_users(id), created_at timestamptz not null default now());
create index mr2_invite_creator on public.mr2_invites(created_by);
create table public.mr2_rates(key text primary key, count integer not null default 0, resets_at timestamptz not null);
alter table public.mr2_config enable row level security;
alter table public.mr2_users enable row level security;
alter table public.mr2_sessions enable row level security;
alter table public.mr2_invites enable row level security;
alter table public.mr2_rates enable row level security;
revoke all on public.mr2_config,public.mr2_users,public.mr2_sessions,public.mr2_invites,public.mr2_rates from public,anon,authenticated;
grant all on public.mr2_config,public.mr2_users,public.mr2_sessions,public.mr2_invites,public.mr2_rates to service_role;
create function public.mr2_rate(p_key text,p_limit integer) returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 insert into public.mr2_rates(key,count,resets_at) values(p_key,1,now()+interval '15 minutes') on conflict(key) do update set count=case when public.mr2_rates.resets_at<now() then 1 else public.mr2_rates.count+1 end,resets_at=case when public.mr2_rates.resets_at<now() then now()+interval '15 minutes' else public.mr2_rates.resets_at end returning count into n;
 return n<=p_limit;
end;$$;
create function public.mr2_register(p_token text,p_email text,p_name text,p_hash text,p_salt text,p_session text,p_recovery text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg public.mr2_config; invitation public.mr2_invites; person public.mr2_users;
begin
 select * into cfg from public.mr2_config where id=1 for update;
 if not found then raise exception 'Workspace not configured'; end if;
 if not cfg.claimed then
  if p_token<>cfg.setup_hash then raise exception 'A valid owner setup link is required'; end if;
  insert into public.mr2_users(email,name,password_hash,salt,recovery_hash,role,founder) values(p_email,p_name,p_hash,p_salt,p_recovery,'admin',true) returning * into person;
  update public.mr2_config set claimed=true,setup_hash='' where id=1;
 else
  select * into invitation from public.mr2_invites where token_hash=p_token and not used and expires_at>now() and email=p_email for update;
  if not found then raise exception 'A valid invitation for this email is required'; end if;
  if invitation.kind='join' then
   insert into public.mr2_users(email,name,password_hash,salt,role) values(p_email,p_name,p_hash,p_salt,invitation.role) returning * into person;
  else
   update public.mr2_users set password_hash=p_hash,salt=p_salt where email=p_email and active returning * into person;
   if not found then raise exception 'Account unavailable'; end if;
   delete from public.mr2_sessions where user_id=person.id;
  end if;
  update public.mr2_invites set used=true where token_hash=p_token;
 end if;
 insert into public.mr2_sessions(token_hash,user_id,expires_at) values(p_session,person.id,now()+interval '7 days');
 return jsonb_build_object('id',person.id,'email',person.email,'name',person.name,'role',person.role,'founder',person.founder);
end;$$;
create function public.mr2_password(p_user uuid,p_hash text,p_salt text,p_session text) returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.mr2_users set password_hash=p_hash,salt=p_salt where id=p_user and active;
 if not found then raise exception 'Account unavailable'; end if;
 delete from public.mr2_sessions where user_id=p_user;
 insert into public.mr2_sessions(token_hash,user_id,expires_at) values(p_session,p_user,now()+interval '7 days');
end;$$;
revoke all on function public.mr2_rate(text,integer),public.mr2_register(text,text,text,text,text,text,text),public.mr2_password(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.mr2_rate(text,integer),public.mr2_register(text,text,text,text,text,text,text),public.mr2_password(uuid,text,text,text) to service_role;
