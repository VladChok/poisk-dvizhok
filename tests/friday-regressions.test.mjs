// Permanent FRIDAY regressions: original fixtures/acceptance assertions plus fixed-content validation.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openMemory} from '../memory/store.mjs';
import {migrateToV2} from '../memory/migrate.mjs';
import {migrateToV3} from '../memory/migrate-v3.mjs';
import {openWatch} from '../watch/store.mjs';
import {createHarness} from '../harness/engine.mjs';
const evidence=[];
const AT='2026-10-31T12:00:00.000Z';
const xml=text=>`<rss><channel><item><guid>stable-entry</guid><description>${text}</description></item></channel></rss>`;
const reply=(body,status=200,headers={})=>({status,headers:{'content-type':'application/rss+xml',...headers},body});
async function store(t,deps,clock=()=>AT){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'friday-adversarial-')),dataDir=path.join(root,'state');let watch;
  t.after(()=>{watch?.close();fs.rmSync(root,{recursive:true,force:true});});
  const m=openMemory({dataDir,scope:'public',init:true,clock});m.close();
  await migrateToV2({dataDir,scope:'public',backup:path.join(root,'v1.sqlite'),clock});
  await migrateToV3({dataDir,scope:'public',backup:path.join(root,'v2.sqlite'),clock});
  watch=openWatch({dataDir,scope:'public',write:true,clock},{harness:deps});return watch;
}
for(const crossOrigin of [true,false])test(`R1 ${crossOrigin?'cross-origin':'same-origin/path'} redirect validator must not validate a different URI`,async t=>{
  const a='https://feeds.example.com/feed',b=crossOrigin?'https://cdn.example.com/actual':'https://feeds.example.com/actual';let phase=0;const calls=[];
  const deps={token:'',clock:()=>Date.parse(AT),lookup:async()=>[{address:'8.8.8.8',family:4}],sleep:async()=>{},wire:async(url,options)=>{
    const tag=options.headers['if-none-match']||null;calls.push({phase,url:url.href,ifNoneMatch:tag});
    if(phase===0&&url.href===a)return reply('',302,{location:b});
    if(phase===0&&url.href===b)return reply(xml('old representation from redirected URI'),200,{etag:'"v1"'});
    if(phase===1&&url.href===a)return tag==='"v1"'?reply('',304,{etag:'"v1"'}):reply(xml('different current representation at original URI'),200,{etag:'"v1"'});
    throw Error('Unexpected fixture request');
  }};
  const watch=await store(t,deps),config={allowedHosts:['feeds.example.com','cdn.example.com'],feeds:[a],limits:{retries:0,minIntervalMs:0}};
  const added=watch.add({name:'redirect-case',source:'rss',url:a,interval:'1h',config});
  const first=await watch.run(added.id);phase=1;const second=await watch.run(added.id);
  // An unconditional control request demonstrates the changed current source.
  const control=await createHarness(config,deps).retrieve('rss',{url:a});
  evidence.push({id:crossOrigin?'R1-cross-origin':'R1-same-origin-path',firstKinds:first.events.map(e=>e.kind),secondKinds:second.events.map(e=>e.kind),emitted:second.emitted,
    cachedContentDigest:second.events[0]?.right?.contentDigest,cachedRepresentationHash:second.events[0]?.right?.hash,controlStatus:control.status,controlContent:control.observations[0]?.content,
    controlHash:control.observations[0]?.hash,storedValidator:watch.get(added.id).validators,calls});
  assert.equal(control.status,'OK');
  assert.ok(!second.events.every(e=>e.kind==='NOT_MODIFIED'),'False NOT_MODIFIED: validator from redirected resource was sent to another URI with an independently valid identical ETag');
  assert.equal(second.events[0]?.right?.hash,control.observations[0]?.hash,'Fixed capture must match the changed unconditional representation');
  assert.ok(second.events.some(e=>e.kind==='CHANGED')); assert.equal(second.emitted,true);
});
test('R2 disable/re-enable at the same clock instant must not permanently replay an old due key',async t=>{
  let count=0,instant=AT;const deps={token:'',lookup:async()=>[{address:'8.8.8.8',family:4}],sleep:async()=>{},wire:async()=>{count++;return reply(xml(count===1?'first':'changed'),200,{etag:`"${count}"`});}};
  const watch=await store(t,deps,()=>instant),added=watch.add({name:'resume-case',source:'rss',url:'https://feeds.example.com/feed',interval:'1h',config:{allowedHosts:['feeds.example.com'],feeds:['https://feeds.example.com/feed'],limits:{retries:0,minIntervalMs:0}}});
  watch.control(added.id,'ENABLE');const first=await watch.due();watch.control(added.id,'DISABLE');watch.control(added.id,'ENABLE');
  const second=await watch.due(),third=await watch.due();instant='2026-10-31T14:00:00.000Z';const later=await watch.due(),state=watch.show(added.id);
  evidence.push({id:'R2',fixtureClock:AT,requests:count,firstAttempt:first.results[0]?.attempt,secondDuplicate:second.results[0]?.duplicate,thirdDuplicate:third.results[0]?.duplicate,
    advancedClock:instant,laterDuplicate:later.results[0]?.duplicate,reportedNextDue:second.results[0]?.nextDueAt,persistedNextDue:state.nextDueAt,state:state.state,historyAttempts:watch.history(added.id,{all:true}).attempts.length});
  assert.ok(state.nextDueAt>instant,'Due timestamp remains expired even after the clock advances; every invocation replays the old COMPLETED request without changing schedule state');
});
test.after(()=>{if(process.env.FRIDAY_EVIDENCE_FILE)fs.writeFileSync(process.env.FRIDAY_EVIDENCE_FILE,JSON.stringify({base:'8208567e1ae7b30e0ae0e02ea8ad0f7c86774a3c',watch:'OFF',cases:evidence},null,2)+'\n');});
