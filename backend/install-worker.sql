-- One minute worker; only this application's limited worker token is placed in the scheduler.
create extension if not exists pg_net with schema extensions;
do $$
declare worker text;
begin
 select decrypted_secret into worker from vault.decrypted_secrets where name='mr2_delivery_worker';
 if worker is null then
  worker=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  perform vault.create_secret(worker,'mr2_delivery_worker','Hamthel Mail Room worker-only token');
 end if;
 update public.mr2_delivery_config set worker_hash=encode(sha256(convert_to(worker,'UTF8')),'hex') where id=1;
end $$;
select cron.schedule('mr2-mailroom-delivery','* * * * *',$job$
 select net.http_post(
  url:='https://emxuvmpjamejoggjwaul.supabase.co/functions/v1/mailroom-delivery/worker',
  headers:=jsonb_build_object('Content-Type','application/json','x-mailroom-worker',(select decrypted_secret from vault.decrypted_secrets where name='mr2_delivery_worker')),
  body:='{}'::jsonb,timeout_milliseconds:=120000
 );
$job$);
