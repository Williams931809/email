import {deliveryPublic,DeliveryError} from './delivery.ts';
const url=Deno.env.get('SUPABASE_URL')!,secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function db(path:string,method='GET',body?:unknown){
 const r=await fetch(url+'/rest/v1/'+path,{method,headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok)throw new Error('Delivery storage unavailable');const text=await r.text();return text?JSON.parse(text):null;
}
Deno.serve(async(req:Request)=>{try{return await deliveryPublic(req,db,secret,url+'/functions/v1/mailroom-delivery');}catch(e){return Response.json({error:e instanceof DeliveryError?e.message:'Delivery service could not complete this request.'},{status:e instanceof DeliveryError?e.status:500,headers:{'Cache-Control':'no-store'}});}});
