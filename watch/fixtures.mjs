import {fields} from '../analysis/records.mjs';
import {fail} from '../memory/safety.mjs';
// Explicit offline transport for tests/operator reproduction, never a network fallback.
export function fixtureTransport(input){
  fields(input,['version','responses'],['version','responses']);
  if(input.version!==1||!Array.isArray(input.responses)||input.responses.length>100)fail('INVALID_HTTP_FIXTURE');
  const queue=[...input.responses];
  for(const r of queue){fields(r,['url','status','responseHeaders','body'],['url','status','responseHeaders','body']);if(typeof r.url!=='string'||!Number.isInteger(r.status)||r.status<100||r.status>599||typeof r.body!=='string'||Buffer.byteLength(r.body)>4194304||!r.responseHeaders||typeof r.responseHeaders!=='object'||Array.isArray(r.responseHeaders)||Object.entries(r.responseHeaders).some(([k,v])=>!['content-type','etag','last-modified','link','location','retry-after','x-ratelimit-remaining','x-ratelimit-reset'].includes(k)||typeof v!=='string'))fail('INVALID_HTTP_FIXTURE');}
  return {token:'',lookup:async()=>[{address:'8.8.8.8',family:4}],sleep:async()=>{},wire:async url=>{const r=queue.shift();if(!r||r.url!==url.href)throw new Error('FIXTURE_ROUTE_MISMATCH');return {status:r.status,headers:r.responseHeaders,body:r.body};}};
}
