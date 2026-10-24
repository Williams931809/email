(function(){
 const pending=new Map();let counter=0;const originalFetch=window.fetch.bind(window);
 window.__mailroomApiResolve=function(id,status,body){const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);p.resolve(new Response(body,{status:status,headers:{'Content-Type':'application/json'}}));};
 window.fetch=function(input,init){init=init||{};let path=typeof input==='string'?input:(input&&input.url)||'';
 try{const parsed=new URL(path,location.origin);if(parsed.origin!==location.origin||!parsed.pathname.startsWith('/api/'))return originalFetch(input,init);path=parsed.pathname.slice(5);}catch(e){return originalFetch(input,init);}
 return new Promise((resolve,reject)=>{const id='request-'+(++counter);const timer=setTimeout(()=>{pending.delete(id);reject(new Error('The connection timed out. Check your internet and retry.'));},35000);pending.set(id,{resolve,reject,timer});try{MailroomApi.request(id,path,init.method||'GET',init.body||'{}');}catch(e){clearTimeout(timer);pending.delete(id);reject(new Error('The connection service is unavailable.'));}});
 };
})();
