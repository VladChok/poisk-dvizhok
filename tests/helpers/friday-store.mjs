import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openMemory} from '../../memory/store.mjs';
import {migrateToV2} from '../../memory/migrate.mjs';
import {migrateToV3} from '../../memory/migrate-v3.mjs';
import {openWatch} from '../../watch/store.mjs';
export const A='https://feeds.example.com/feed', B='https://feeds.example.com/other';
export const AT='2026-10-31T12:00:00.000Z';
export const xml=(text='first')=>`<rss><channel><item><guid>one</guid><description>${text}</description></item></channel></rss>`;
export const response=(body=xml(),status=200,headers={etag:'"v1"'})=>({status,headers:{'content-type':'application/rss+xml',...headers},body});
export const spec=(extra={})=>({name:'regression',source:'rss',url:A,interval:'1h',config:{allowedHosts:['feeds.example.com','cdn.example.com','api.github.com'],feeds:[A],limits:{retries:0,minIntervalMs:0}},...extra});
export async function setup(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'friday-fix-')),dataDir=path.join(root,'state'),handles=[],queue=[],calls=[];
  let at=AT;const clock=()=>at;
  t.after(()=>{for(const m of handles)if(m.db.open)m.close();fs.rmSync(root,{recursive:true,force:true});});
  const m=openMemory({dataDir,scope:'public',init:true,clock});m.close();
  await migrateToV2({dataDir,scope:'public',backup:path.join(root,'v1.sqlite'),clock});
  await migrateToV3({dataDir,scope:'public',backup:path.join(root,'v2.sqlite'),clock});
  const harness={token:'',lookup:async()=>[{address:'8.8.8.8',family:4}],sleep:async()=>{},wire:async(url,options)=>{
    calls.push({url:url.href,...options});const next=queue.shift();if(typeof next==='function')return next(url,options);if(!next)throw Error('Missing fixture');return next;
  }};
  const open=()=>{const w=openWatch({dataDir,scope:'public',write:true,clock},{harness});handles.push(w.memory);return w;};
  return {root,dataDir,clock,set:value=>{at=value;},queue,calls,harness,open,track:memory=>handles.push(memory),w:open()};
}
