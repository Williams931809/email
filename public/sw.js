// No authenticated pages, API responses or credentials are cached.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hamthel Mail Room</title><body style="font:16px/1.8 Arial;padding:30px;color:#304332"><h1 style="font-size:26px">You’re offline.</h1><p>Connect to the internet and reopen Hamthel Mail Room to access your workspace.</p></body></html>',{headers:{'Content-Type':'text/html;charset=utf-8'}})));});
