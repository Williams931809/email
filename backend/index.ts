// Supabase Edge Function: no dependency on Supabase Auth or other app accounts.
import {digest,equal,passwordHash,token,validPassword,email} from './crypto.mjs';
const DB_URL=Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
class HttpError extends Error {constructor(public status:number,message:string){super(message)}}
async function db(path:string,method='GET',body?:unknown){const r=await fetch(DB_URL+'/rest/v1/'+path,{method,headers:{apikey:SERVICE_KEY,Authorization:'Bearer '+SERVICE_KEY,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();if(!r.ok){if(r.status===409)throw new HttpError(409,'An account with that email already exists. Sign in or ask an admin for a reset link.');throw new HttpError(500,'The database could not complete this request. Please retry.')}return text?JSON.parse(text):null;}
function profile(u:any){return {id:u.id,email:u.email,name:u.name,role:u.role,founder:u.founder};}
function fail(status:number,message:string):never{throw new HttpError(status,message)}
async function limit(key:string,max:number){if(!await db('rpc/mr2_rate','POST',{p_key:await digest(key),p_limit:max}))fail(429,'Too many attempts. Please wait 15 minutes and try again.');}
function validWorkspace(b:any){if(!b||!Array.isArray(b.contacts)||b.contacts.length>10000||!Array.isArray(b.campaigns)||b.campaigns.length>300||!Array.isArray(b.sequences)||b.sequences.length>100||!b.settings)return false;const short=(x:any,n=10000)=>typeof x==='string'&&x.length<=n;const ids=new Set();for(const c of b.contacts){if(!c||!short(c.id,100)||ids.has(c.id)||!email(c.email)||!short(c.name)||!short(c.tags)||!['Subscribed','Unsubscribed'].includes(c.status))return false;ids.add(c.id)}for(const c of b.campaigns){if(!c||!['id','name','subject','preview','body','segment','status','date'].every(k=>short(c[k],k==='body'?100000:10000))||c.status!=='Draft')return false}for(const s of b.sequences){if(!s||!short(s.id,100)||!short(s.name)||!short(s.trigger)||!Array.isArray(s.steps)||!s.steps.length||s.steps.length>100||s.steps.some((x:any)=>!x||!short(x.subject)||!short(x.body,100000)||!Number.isInteger(x.days)||x.days<0||x.days>365))return false}return ['company','from','reply','address','color'].every(k=>short(b.settings[k]))&&/^#[0-9a-f]{6}$/i.test(b.settings.color)}
Deno.serve(async(req:Request)=>{
 try{
  if(req.method!=='POST')fail(405,'Method not allowed.');
  const supplied=req.headers.get('x-mailroom-proxy')||'';
  if(!supplied)fail(401,'Application access required.');
  const configs=await db('mr2_config?id=eq.1&select=claimed,bridge_hash,setup_hash');const cfg=configs?.[0];
  if(!cfg||!equal(await digest(supplied),cfg.bridge_hash))fail(401,'Application access required.');
  const text=await req.text();if(text.length>2100000)fail(413,'Request is too large.');
  let input;try{input=JSON.parse(text)}catch{fail(400,'Invalid request.');}
  const {path,method,body:b={},session='',ip='unknown'}=input;
  if(typeof path!=='string'||typeof session!=='string')fail(400,'Invalid request.');
  let current:any=null;
  if(session&&session.length<=128){const sessions=await db('mr2_sessions?token_hash=eq.'+await digest(session)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=user_id');if(sessions?.[0]){const users=await db('mr2_users?id=eq.'+sessions[0].user_id+'&active=eq.true&select=*');current=users?.[0]||null;}}
  const ok=(data:any={})=>Response.json(data,{headers:{'Cache-Control':'no-store'}});
  if(path==='auth/status'&&method==='GET')return ok({user:current?profile(current):null,setupAvailable:!cfg.claimed});
  if(path==='auth/logout'&&method==='POST'){if(session)await db('mr2_sessions?token_hash=eq.'+await digest(session),'DELETE');return ok({ok:true,__clear:true});}
  if(['auth/login','auth/register','auth/recover'].includes(path)&&method==='POST'){
   await limit('ip:'+ip,30);const address=email(b.email);if(!address)fail(400,'Enter a valid email address.');await limit('account:'+address,8);
   if(path==='auth/login'){
    if(typeof b.password!=='string'||b.password.length>128)fail(400,'Enter your email and password.');
    const rows=await db('mr2_users?email=eq.'+encodeURIComponent(address)+'&select=*');const user=rows?.[0];
    const actual=await passwordHash(b.password,user?.salt||'mailroom-unavailable-account');
    if(!user||!equal(actual,user.password_hash)||!user.active)fail(401,'The email or password is incorrect, or this account is disabled.');
    const secret=token();await db('mr2_sessions','POST',{token_hash:await digest(secret),user_id:user.id,expires_at:new Date(Date.now()+7*86400000).toISOString()});return ok({user:profile(user),__session:secret});
   }
   if(!validPassword(b.password))fail(400,'Use a password between 12 and 128 characters.');
   const salt=token(24),hash=await passwordHash(b.password,salt),secret=token();
   if(path==='auth/recover'){
    if(typeof b.recoveryCode!=='string'||b.recoveryCode.length>200)fail(400,'Enter your owner recovery code.');
    const rows=await db('mr2_users?email=eq.'+encodeURIComponent(address)+'&founder=eq.true&active=eq.true&select=*');const user=rows?.[0];
    if(!user?.recovery_hash||!equal(await digest(b.recoveryCode.trim()),user.recovery_hash))fail(401,'The recovery details are incorrect.');
    await db('rpc/mr2_password','POST',{p_user:user.id,p_hash:hash,p_salt:salt,p_session:await digest(secret)});return ok({user:profile(user),__session:secret});
   }
   if(typeof b.token!=='string'||b.token.length>200||typeof b.name!=='string'||!b.name.trim()||b.name.length>100)fail(400,'Enter your name and open your setup or invitation link.');
   const tokenHash=await digest(b.token);
   if(!cfg.claimed){if(!equal(tokenHash,cfg.setup_hash))fail(403,'Open your private owner setup link to create the first admin account.');}
   else {const invites=await db('mr2_invites?token_hash=eq.'+tokenHash+'&used=eq.false&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&email=eq.'+encodeURIComponent(address)+'&select=email');if(!invites?.[0])fail(403,'Registration is closed. An unexpired invitation for this email is required.');}
   const recoveryCode=token(24);
   let user;
   try{user=await db('rpc/mr2_register','POST',{p_token:tokenHash,p_email:address,p_name:b.name.trim(),p_hash:hash,p_salt:salt,p_session:await digest(secret),p_recovery:await digest(recoveryCode)});}catch(e){if(e instanceof HttpError&&e.status===409)throw e;fail(409,'This setup or invitation was already used. Please sign in or request a new link.');}
   return ok({user,__session:secret,...(user.founder&&!cfg.claimed?{recoveryCode}:{})});
  }
  if(path==='auth/invitation'&&method==='POST'){
   await limit('invite:'+ip,30);if(typeof b.token!=='string'||b.token.length>200)fail(400,'Invalid invitation.');
   const found=await db('mr2_invites?token_hash=eq.'+await digest(b.token)+'&used=eq.false&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=email,role,kind');if(!found?.[0])fail(404,'This invitation has expired or was already used.');return ok(found[0]);
  }
  if(!current)fail(401,'Please sign in to continue.');
  if(path==='auth/password'&&method==='POST'){
   await limit('password:'+current.id,8);if(typeof b.oldPassword!=='string'||b.oldPassword.length>128||!equal(await passwordHash(b.oldPassword,current.salt),current.password_hash))fail(401,'Your current password is incorrect.');if(!validPassword(b.password))fail(400,'Use a password between 12 and 128 characters.');
   const salt=token(24),secret=token();await db('rpc/mr2_password','POST',{p_user:current.id,p_hash:await passwordHash(b.password,salt),p_salt:salt,p_session:await digest(secret)});return ok({ok:true,__session:secret});
  }
  if(path==='workspace'&&method==='GET'){const rows=await db('mr2_config?id=eq.1&select=data,version');return ok(rows[0]);}
  if(path==='workspace'&&method==='PUT'){
   const {data,version}=b;if(!Number.isSafeInteger(version)||!validWorkspace(data)||JSON.stringify(data).length>2000000)fail(400,'Invalid workspace. Check contact emails and record limits.');
   if(current.role!=='admin'){const previous=await db('mr2_config?id=eq.1&select=data');if(JSON.stringify(previous[0].data?.settings)!==JSON.stringify(data.settings))fail(403,'Only an admin can change company settings.');}
   const changed=await db('mr2_config?id=eq.1&version=eq.'+version,'PATCH',{data,version:version+1});if(!changed?.[0])fail(409,'Someone else saved changes. Download a backup, reload the workspace, and try again.');return ok({ok:true,version:version+1});
  }
  if(path.startsWith('team')){
   if(current.role!=='admin')fail(403,'Only an admin can manage company access.');
   if(path==='team'&&method==='GET'){const users=await db('mr2_users?select=id,email,name,role,founder,active,created_at&order=created_at.asc');const invites=await db('mr2_invites?used=eq.false&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=email,kind,role,expires_at,created_at&order=created_at.desc');return ok({users,invites});}
   if(path==='team/invite'&&method==='POST'){
    await limit('team:'+current.id,30);const address=email(b.email);if(!address)fail(400,'Enter a valid email address.');const kind=b.kind==='reset'?'reset':'join';const role=b.role==='admin'?'admin':'member';const rows=await db('mr2_users?email=eq.'+encodeURIComponent(address)+'&select=id,founder');
    if(kind==='join'&&rows?.[0])fail(409,'This person already has an account. Use a password reset link instead.');if(kind==='reset'&&!rows?.[0])fail(404,'No account found for this email.');if(kind==='reset'&&rows[0].founder)fail(403,'The owner uses their recovery code or changes their own password.');
    await db('mr2_invites?email=eq.'+encodeURIComponent(address)+'&kind=eq.'+kind+'&used=eq.false','PATCH',{used:true});const invitation=token();const expires=new Date(Date.now()+7*86400000).toISOString();await db('mr2_invites','POST',{token_hash:await digest(invitation),email:address,role,kind,expires_at:expires,created_by:current.id});return ok({token:invitation,email:address,kind,expires});
   }
   if(path==='team/revoke-invite'&&method==='POST'){const address=email(b.email);if(!address)fail(400,'Invalid email.');await db('mr2_invites?email=eq.'+encodeURIComponent(address)+'&used=eq.false','PATCH',{used:true});return ok({ok:true});}
   if(path==='team/member'&&method==='POST'){
    if(typeof b.id!=='string'||!/^[0-9a-f-]{36}$/i.test(b.id))fail(400,'Invalid member.');const rows=await db('mr2_users?id=eq.'+b.id+'&select=id,founder');if(!rows?.[0])fail(404,'Member not found.');if(rows[0].founder||b.id===current.id)fail(403,'The owner and your own account cannot be disabled or demoted here.');
    if(typeof b.active!=='boolean'||!['admin','member'].includes(b.role))fail(400,'Invalid role or account status.');await db('mr2_users?id=eq.'+b.id,'PATCH',{active:b.active,role:b.role});await db('mr2_sessions?user_id=eq.'+b.id,'DELETE');return ok({ok:true});
   }
  }
  fail(404,'This action is not available.');
 }catch(e){return Response.json({error:e instanceof HttpError?e.message:'Something went wrong. Please retry.'},{status:e instanceof HttpError?e.status:500,headers:{'Cache-Control':'no-store'}});}
});
