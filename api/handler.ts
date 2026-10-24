import type { IncomingMessage, ServerResponse } from 'node:http';
type Req=IncomingMessage&{body?:unknown;query?:Record<string,string|string[]>};
export default async function handler(req:Req,res:ServerResponse){
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
 const respond=(code:number,value:unknown)=>{res.statusCode=code;res.end(JSON.stringify(value));};
 try{
  const method=req.method||'GET';if(!['GET','POST','PUT'].includes(method))return respond(405,{error:'Method not allowed.'});
  const host=req.headers.host||'';const origin=req.headers.origin;
  if((origin&&origin!=='https://'+host&&origin!=='http://'+host)||req.headers['sec-fetch-site']==='cross-site')return respond(403,{error:'Request origin not allowed.'});
  const key=process.env.MAILROOM_PROXY_KEY,backend=process.env.MAILROOM_BACKEND_URL;if(!key||!backend)return respond(503,{error:'The account service is awaiting secure hosting configuration.'});
  const url=new URL(req.url||'/', 'https://'+host);const raw=req.query?.route||url.searchParams.get('route')||url.pathname.replace(/^\/api\//,'');const route=Array.isArray(raw)?raw.join('/'):raw;
  if(!/^[a-z/-]+$/.test(route))return respond(400,{error:'Invalid route.'});
  let body:unknown={};if(method!=='GET'){
   if(!req.headers['content-type']?.includes('application/json'))return respond(415,{error:'JSON content required.'});
   if(req.body!==undefined){body=typeof req.body==='string'?JSON.parse(req.body):req.body;}else{let text='';for await(const chunk of req){text+=chunk;if(text.length>2100000)return respond(413,{error:'Request is too large.'});}body=text?JSON.parse(text):{};}
   if(JSON.stringify(body).length>2100000)return respond(413,{error:'Request is too large.'});
  }
  const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-mailroom='));const session=cookie?.slice('__Host-mailroom='.length)||'';
  const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-real-ip']||req.socket.remoteAddress||'unknown').split(',')[0];
  const upstream=await fetch(backend,{method:'POST',headers:{'Content-Type':'application/json','x-mailroom-proxy':key},body:JSON.stringify({path:route,method,body,session,ip}),signal:AbortSignal.timeout(25000)});
  const data=await upstream.json() as Record<string,unknown>;
  if(data.__session){res.setHeader('Set-Cookie','__Host-mailroom='+data.__session+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800');delete data.__session;}
  if(data.__clear){res.setHeader('Set-Cookie','__Host-mailroom=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');delete data.__clear;}
  return respond(upstream.status,data);
 }catch{return respond(502,{error:'The account service is temporarily unavailable. Please retry.'});}
}
