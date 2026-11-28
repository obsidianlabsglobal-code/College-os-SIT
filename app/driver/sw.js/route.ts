export const dynamic="force-static";
// Network-only routing: never cache driver data, enrollment responses, auth cookies, or API calls.
export function GET(){
  return new Response(`self.addEventListener('install',() => self.skipWaiting());
self.addEventListener('activate',event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event => {
  const url=new URL(event.request.url);
  if(event.request.mode!=='navigate'||url.origin!==self.location.origin||url.pathname!=='/driver')return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="kn"><meta name="viewport" content="width=device-width"><title>NEXUS Driver</title><h1>NEXUS Driver</h1><p>ಸಂಪರ್ಕವಿಲ್ಲ. ಸುರಕ್ಷಿತವಾಗಿ ನಿಲ್ಲಿಸಿ, ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.</p><p>Offline. Stop safely and reopen when connected. This screen cannot send an SOS.</p></html>',
    {headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'}})));
});`,{headers:{"Content-Type":"text/javascript; charset=utf-8","Service-Worker-Allowed":"/driver","Cache-Control":"no-cache"}});
}
