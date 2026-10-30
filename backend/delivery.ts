import {cryptKey,DeliveryError,reject,normalizeEmail,hex,random,fixedEqual,eligible,validateMessage,renderForRecipient,textForRecipient,eventStatus,unsubscribePage} from './delivery-core.ts';
type DB=(path:string,method?:string,body?:unknown)=>Promise<any>;
type Context={db:DB;secret:string;baseUrl:string;current:any;limit:(key:string,max:number)=>Promise<void>};
const Q=encodeURIComponent;
const cfg=async(db:DB)=>(await db('mr2_delivery_config?id=eq.1&select=*'))[0];
const workspace=async(db:DB)=>(await db('mr2_config?id=eq.1&select=data'))[0].data;
async function brevo(key:string,path:string,method='GET',body?:any){
 let r:Response;try{r=await fetch('https://api.brevo.com/v3/'+path,{method,headers:{'api-key':key,'Content-Type':'application/json','Accept':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});}catch{reject(502,'Brevo could not be reached. Please retry.');}
 const data=await r.text();let j:any={};try{j=data?JSON.parse(data):{};}catch{}
 if(!r.ok)reject(r.status===401||r.status===403?400:502,r.status===401||r.status===403?'Brevo rejected the API key or server IP. Check your Brevo API settings.':'Brevo could not complete this request. Check the key, sender, and account status.');
 return j;
}
async function verification(key:string,w:any){const [account,senders]=await Promise.all([brevo(key,'account'),brevo(key,'senders')]);const sender=normalizeEmail(w.settings.from);return {verified:senders.senders?.some((s:any)=>s.active&&normalizeEmail(s.email)===sender)&&account.relay?.enabled!==false,sender};}
export async function deliveryAction(input:any,ctx:Context):Promise<any>{
 const {path,method,body:b={}}=input,{db,current,secret,baseUrl,limit}=ctx;
 if(!path.startsWith('delivery/'))return undefined;
 if(!current)reject(401,'Please sign in to continue.');
 const config=await cfg(db),w=await workspace(db);
 if(path==='delivery/status'&&method==='GET'){
  const today=new Date().toISOString().slice(0,10);const [daily,automations,totals]=await Promise.all([db('mr2_daily?day=eq.'+today+'&select=reserved'),db('mr2_automations?select=sequence_id,enabled'),db('rpc/mr2_delivery_totals','POST',{})]);
  return {connected:!!config.encrypted_key,enabled:config.enabled,verifiedSender:config.verified_sender||'',senderReady:config.verified_sender===normalizeEmail(w.settings.from),dailyLimit:config.daily_limit,usedToday:daily[0]?.reserved||0,webhookReady:!!config.webhook_id,workerAt:config.last_worker_at,workerReady:!!config.worker_hash,error:current.role==='admin'?config.last_error:null,automations,totals};
 }
 if(current.role!=='admin')reject(403,'Only an admin can configure delivery or send emails.');
 if(path==='delivery/connect'&&method==='POST'){
  await limit('brevo:'+current.id,8);
  if(typeof b.key!=='string'||b.key.trim().length<30||b.key.length>512)reject(400,'Enter your Brevo API key.');
  const key=b.key.trim(),check=await verification(key,w),hookSecret=random();
  const hook=await brevo(key,'webhooks','POST',{url:baseUrl+'/webhook',description:'Hamthel Mail Room delivery events',type:'transactional',events:['delivered','hardBounce','softBounce','blocked','spam','invalid','unsubscribed','opened','click'],headers:[{key:'x-mailroom-webhook',value:hookSecret}]});
  if(!Number.isInteger(hook.id))reject(502,'Brevo did not confirm the delivery webhook.');
  await db('mr2_delivery_config?id=eq.1','PATCH',{encrypted_key:await cryptKey(key,secret),webhook_hash:await hex(hookSecret),webhook_id:hook.id,verified_sender:check.verified?check.sender:null,enabled:false,verified_at:new Date().toISOString(),last_error:null,updated_at:new Date().toISOString()});
  return {ok:true,verified:check.verified,message:check.verified?'Brevo connected. Enable delivery when you are ready.':'Brevo connected. Verify the sender in Brevo, save company settings, then check the sender again.'};
 }
 if(path==='delivery/verify'&&method==='POST'){
  await limit('brevo:'+current.id,8);if(!config.encrypted_key)reject(400,'Connect Brevo first.');const check=await verification(await cryptKey(config.encrypted_key,secret,true),w);
  await db('mr2_delivery_config?id=eq.1','PATCH',{verified_sender:check.verified?check.sender:null,verified_at:new Date().toISOString(),enabled:check.verified&&config.enabled,last_error:null});return {verified:check.verified};
 }
 if(path==='delivery/toggle'&&method==='POST'){
  if(typeof b.enabled!=='boolean')reject(400,'Choose enable or pause.');
  if(b.enabled){if(!config.encrypted_key||!config.webhook_id||!config.worker_hash)reject(400,'Complete Brevo setup first.');const check=await verification(await cryptKey(config.encrypted_key,secret,true),w);if(!check.verified||!w.settings.address?.trim()||w.settings.address.trim().length<5)reject(400,'Save your postal address and verify the sender in Brevo first.');await db('mr2_delivery_config?id=eq.1','PATCH',{verified_sender:check.sender});}
  await db('mr2_delivery_config?id=eq.1','PATCH',{enabled:b.enabled,last_error:null});return {ok:true};
 }
 if(path==='delivery/queue'&&method==='POST'){
  await limit('send:'+current.id,30);if(!/^[0-9a-f-]{36}$/i.test(b.requestId||''))reject(400,'Invalid request identifier.');
  const c=w.campaigns.find((c:any)=>c.id===b.campaignId);validateMessage(c);
  if(!config.enabled||config.verified_sender!==normalizeEmail(w.settings.from))reject(400,'Enable delivery and verify your current sender first.');
  let due=new Date(b.scheduledAt||Date.now());if(!Number.isFinite(+due)||+due<Date.now()-60000||+due>Date.now()+365*86400000)reject(400,'Choose a future date within the next year.');
  const count=await db('rpc/mr2_queue_campaign','POST',{p_run:b.requestId,p_campaign:b.campaignId,p_due:due.toISOString(),p_actor:current.id,p_test:b.test===true});return {runId:b.requestId,count};
 }
 if(path==='delivery/runs'&&method==='GET')return {runs:await db('rpc/mr2_delivery_runs','POST',{}),jobs:await db('mr2_jobs?select=id,run_id,email,status,error,provider_id,due_at,accepted_at,delivered_at,opened_at,clicked_at&order=created_at.desc&limit=300')};
 if(path==='delivery/cancel'&&method==='POST'){
  if(!/^[0-9a-f-]{36}$/i.test(b.runId||''))reject(400,'Invalid delivery.');await db('mr2_jobs?run_id=eq.'+b.runId+'&status=eq.pending','PATCH',{status:'cancelled',error:'Cancelled by an admin'});return {ok:true};
 }
 if(path==='delivery/resubscribe'&&method==='POST'){
  const address=normalizeEmail(b.email);if(!address||b.consent!==true)reject(400,'Confirm the contact’s renewed permission.');const s=await db('mr2_suppressions?email=eq.'+Q(address));if(s[0]&&['spam','hard_bounce','blocked','invalid'].includes(s[0].reason))reject(400,'This address is blocked after delivery feedback. Resolve it in Brevo first.');await db('mr2_suppressions?email=eq.'+Q(address),'DELETE');return {ok:true};
 }
 if(path==='delivery/automation'&&method==='POST'){
  const s=w.sequences.find((s:any)=>s.id===b.sequenceId);if(!s)reject(400,'Save the sequence first.');
  if(b.enabled){if(!config.enabled)reject(400,'Enable delivery first.');if(s.steps.length>20)reject(400,'Use at most 20 emails per active sequence.');s.steps.forEach(validateMessage);if(s.trigger==='Tag added'&&!s.triggerTag?.trim())reject(400,'Choose the tag that starts this sequence.');}
  const existing=await db('mr2_automations?sequence_id=eq.'+Q(s.id));
  if(existing[0])await db('mr2_automations?sequence_id=eq.'+Q(s.id),'PATCH',{enabled:b.enabled===true,...(b.enabled?{definition:s,identity:w.settings}:{})});else await db('mr2_automations','POST',{sequence_id:s.id,enabled:b.enabled===true,definition:s,identity:w.settings,created_by:current.id});
  if(b.enabled&&!existing[0])await db('rpc/mr2_enroll_sequence','POST',{p_sequence:s.id,p_baseline:true,p_manual:false});
  if(!b.enabled)await db('mr2_jobs?sequence_id=eq.'+Q(s.id)+'&status=eq.pending','PATCH',{status:'cancelled',error:'Sequence stopped'});
  return {ok:true};
 }
 if(path==='delivery/enroll'&&method==='POST'){
  await limit('enroll:'+current.id,10);if(!config.enabled)reject(400,'Enable delivery first.');const s=w.sequences.find((s:any)=>s.id===b.sequenceId);if(!s)reject(400,'Save the sequence first.');s.steps.forEach(validateMessage);
  return {count:await db('rpc/mr2_enroll_sequence','POST',{p_sequence:s.id,p_baseline:false,p_manual:true})};
 }
 reject(404,'Unknown delivery action.');
}
export async function suppressedWorkspace(db:DB,w:any){const addresses=await db('mr2_suppressions?select=email');const suppressed=new Set(addresses.map((s:any)=>s.email));return {...w,contacts:w.contacts.map((c:any)=>suppressed.has(c.email.toLowerCase())?{...c,status:'Unsubscribed'}:c)};}
export async function deliveryPublic(req:Request,db:DB,secret:string,baseUrl:string){
 const url=new URL(req.url),action=url.pathname.split('/').pop();
 if(action==='health')return Response.json({ok:true,service:'Hamthel Mail Room delivery'});
 const config=await cfg(db);
 if(action==='unsubscribe'){
  const token=url.searchParams.get('token')||'';if(!/^[0-9a-f]{64}$/.test(token))return new Response('Invalid preference link',{status:400});const rows=await db('mr2_unsubscribe_tokens?token_hash=eq.'+await hex(token)+'&select=email');if(!rows[0])return new Response('This preference link is unavailable.',{status:404});
  if(req.method==='POST')await db('rpc/mr2_suppress','POST',{p_email:rows[0].email,p_reason:'unsubscribed'});else if(req.method!=='GET')return new Response('Method not allowed',{status:405});
  return new Response(unsubscribePage(req.method==='POST'),{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
 }
 if(action==='webhook'){
  if(req.method!=='POST'||!config.webhook_hash||!fixedEqual(await hex(req.headers.get('x-mailroom-webhook')||''),config.webhook_hash))return new Response('Unauthorized',{status:401});
  const raw=await req.text();if(raw.length>100000)return new Response('Too large',{status:413});let events;try{events=JSON.parse(raw);}catch{return new Response('Invalid JSON',{status:400});}
  for(const event of (Array.isArray(events)?events:[events]).slice(0,100)){
   const id=event['message-id']||event.messageId;if(typeof id!=='string'||id.length>500)continue;
   const jobs=await db('mr2_jobs?provider_id=eq.'+Q(id)+'&select=id,email,status,opened_at,clicked_at');const job=jobs[0];if(!job||normalizeEmail(event.email)!==job.email)continue;
   const type=String(event.event).replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),patch:any={};
   if(type==='opened'||type==='unique_opened'){if(!job.opened_at)patch.opened_at=new Date().toISOString();}
   else if(type==='click'){if(!job.clicked_at)patch.clicked_at=new Date().toISOString();}
   else if(type==='delivered'){patch.status='delivered';patch.delivered_at=new Date().toISOString();}
   else if(eventStatus(type)){patch.status=eventStatus(type);patch.error='Brevo: '+type;}
   if(['unsubscribed','hard_bounce','spam','blocked','invalid'].includes(type))await db('rpc/mr2_suppress','POST',{p_email:job.email,p_reason:type});
   if(Object.keys(patch).length)await db('mr2_jobs?id=eq.'+job.id,'PATCH',patch);
  }
  return Response.json({ok:true});
 }
 if(action!=='worker'||req.method!=='POST'||!config.worker_hash||!fixedEqual(await hex(req.headers.get('x-mailroom-worker')||''),config.worker_hash))return new Response('Unauthorized',{status:401});
 if(!config.enabled){await db('mr2_delivery_config?id=eq.1','PATCH',{last_worker_at:new Date().toISOString()});return Response.json({paused:true});}
 const w=await workspace(db),autos=await db('mr2_automations?enabled=eq.true&select=sequence_id');
 for(const a of autos)await db('rpc/mr2_enroll_sequence','POST',{p_sequence:a.sequence_id,p_baseline:false,p_manual:false});
 const jobs=await db('rpc/mr2_claim_jobs','POST',{});if(!jobs.length)return Response.json({processed:0});
 const key=await cryptKey(config.encrypted_key,secret,true);
 for(const job of jobs){
  let patch:any={};
  try{
   const latest=await cfg(db),s=await db('mr2_suppressions?email=eq.'+Q(job.email)+'&select=email');
   const run=(await db('mr2_runs?id=eq.'+job.run_id+'&select=test'))[0];
   const contact=w.contacts.find((c:any)=>c.email.toLowerCase()===job.email);
   if(!latest.enabled){patch={status:'pending',error:null};}
   else if(s.length||(!run?.test&&!eligible(contact))){patch={status:'skipped',error:'Recipient no longer subscribed'};}
   else if(latest.verified_sender!==normalizeEmail(job.identity.from)){patch={status:'failed',error:'The queued sender is no longer verified'};}
   else {
    validateMessage(job.campaign);const token=random();await db('mr2_unsubscribe_tokens','POST',{token_hash:await hex(token),email:job.email});const link=baseUrl+'/unsubscribe?token='+token;
    // A timeout or transport failure is ambiguous: never automatically re-send it.
    let response:Response;try{response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':key,'Content-Type':'application/json','idempotencyKey':job.id},body:JSON.stringify({sender:{email:job.identity.from,name:job.identity.company},to:[{email:job.email,name:job.name||job.email}],...(normalizeEmail(job.identity.reply)?{replyTo:{email:job.identity.reply}}:{}),subject:job.campaign.subject.replaceAll('{{name}}',job.name||'there').replaceAll('{{company}}',job.identity.company),htmlContent:renderForRecipient(job.campaign,job.identity,job.name,link),textContent:textForRecipient(job.campaign,job.identity,job.name,link),headers:{idempotencyKey:job.id,'List-Unsubscribe':'<'+link+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'},tags:['hamthel-mail-room']}),signal:AbortSignal.timeout(12000)});}catch{throw new DeliveryError(504,'Delivery result unknown; not retried automatically.');}
    let result:any={};try{result=await response.json();}catch{}
    if(response.ok&&typeof result.messageId==='string')patch={status:'accepted',provider_id:result.messageId,accepted_at:new Date().toISOString(),error:null};
    else if(response.status===429)patch={status:'pending',due_at:new Date(Date.now()+3600000).toISOString(),error:'Brevo rate limit; waiting before retry'};
    else if(response.status>=500||response.ok)patch={status:'uncertain',error:'Brevo result unknown; review provider logs before sending again'};
    else {patch={status:'failed',error:'Brevo rejected delivery ('+response.status+')'};if(response.status===401||response.status===403)await db('mr2_delivery_config?id=eq.1','PATCH',{enabled:false,last_error:'Brevo rejected the key or server IP. Reconnect or allow your Supabase server in Brevo.'});}
   }
  }catch(e){patch={status:'uncertain',error:e instanceof DeliveryError?e.message:'Processing stopped; review delivery logs before sending again'};}
  await db('mr2_jobs?id=eq.'+job.id+'&status=eq.sending','PATCH',patch);
 }
 return Response.json({processed:jobs.length});
}

export {DeliveryError};
