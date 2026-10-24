const encoder = new TextEncoder();
export function token(size=32){const bytes=crypto.getRandomValues(new Uint8Array(size));return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');}
export async function digest(value){const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(value));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;let mismatch=a.length^b.length;const n=Math.max(a.length,b.length);for(let i=0;i<n;i++)mismatch|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return mismatch===0;}
export async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:600000,hash:'SHA-256'},key,256);return Array.from(new Uint8Array(bits),x=>x.toString(16).padStart(2,'0')).join('');}
export function validPassword(value){return typeof value==='string'&&value.length>=12&&value.length<=128;}
export function email(value){if(typeof value!=='string')return null;const result=value.trim().toLowerCase();return result.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)?result:null;}
