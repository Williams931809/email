import {renderEmail,escapeHtml} from '../src/templates.ts';
export class DeliveryError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status;}}
export function reject(status:number,message:string):never{throw new DeliveryError(status,message);}
export const normalizeEmail=(v:unknown)=>typeof v==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())?v.trim().toLowerCase():null;
export const hex=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');
export const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,'0')).join('');
export function fixedEqual(a:string,b:string){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
export async function cryptKey(value:string,secret:string,decrypt=false){
 const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode('hamthel-mail-delivery:'+secret)),{name:'AES-GCM'},false,['encrypt','decrypt']);
 if(decrypt){const [nonce,data]=value.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(nonce),c=>c.charCodeAt(0))},key,Uint8Array.from(atob(data),c=>c.charCodeAt(0))));}
 const iv=crypto.getRandomValues(new Uint8Array(12)),data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value)));
 return btoa(String.fromCharCode(...iv))+'.'+btoa(String.fromCharCode(...data));
}
export function eligible(contact:any,segment='All subscribers',suppressed:string[]=[]){return contact?.status==='Subscribed'&&Boolean(normalizeEmail(contact.email))&&!suppressed.includes(contact.email.toLowerCase())&&(segment==='All subscribers'||String(contact.tags).split(',').map(s=>s.trim()).includes(segment));}
export function validateMessage(c:any){
 if(!c||typeof c.subject!=='string'||!c.subject.trim()||c.subject.length>250||/[\r\n]/.test(c.subject))reject(400,'Add a subject of up to 250 characters on one line.');
 if(typeof c.body!=='string'||!c.body.trim()||c.body.length>100000)reject(400,'Add a message of up to 100,000 characters.');
 if(c.design){for(const k of ['title','kicker','buttonLabel','buttonUrl','accent','templateId'])if(typeof c.design[k]!=='string'||c.design[k].length>2000)reject(400,'The email design contains invalid values.');}
}
export function renderForRecipient(campaign:any,identity:any,name:string,unsubscribeUrl:string){return renderEmail(campaign,identity,{name:name||'there',unsubscribeUrl});}
export function textForRecipient(c:any,settings:any,name:string,url:string){return c.body.replaceAll('{{name}}',name||'there').replaceAll('{{company}}',settings.company)+'\n\n'+settings.company+'\n'+settings.address+'\nUnsubscribe: '+url;}
export const eventStatus=(event:string)=>(({delivered:'delivered',hard_bounce:'failed',soft_bounce:'failed',blocked:'failed',invalid:'failed',spam:'failed'} as Record<string,string>)[event]||null);
export function unsubscribePage(done=false){return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences — Hamthel Mail Room</title><body style="font:16px/1.7 Arial;margin:50px auto;padding:24px;max-width:460px;color:#263c30"><h1 style="font-size:26px">${done?'You’re unsubscribed.':'Email preferences'}</h1><p>${done?'You will no longer receive marketing emails from this company.':'Choose below to stop receiving marketing emails from this company.'}</p>${done?'':'<form method="post"><button style="background:#324f3d;color:white;border:0;border-radius:6px;padding:14px 22px;font:inherit">Unsubscribe</button></form>'}<p style="font-size:12px;color:#778471">Hamthel Mail Room</p></body></html>`;}
export {escapeHtml};
