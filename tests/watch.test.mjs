import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {openMemory,restoreMemory} from '../memory/store.mjs';
import {migrateToV2} from '../memory/migrate.mjs';
import {migrateToV3} from '../memory/migrate-v3.mjs';
import {openAnalysis} from '../analysis/store.mjs';
import {openWatch} from '../watch/store.mjs';
import {retryDelay} from '../watch/config.mjs';
import {fingerprint} from '../memory/schema.mjs';
import {dataPath} from '../memory/safety.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url)),URL_FEED='https://feeds.example.com/news',AT='2026-10-31T00:00:00.000Z',BRIEF='e0-node-sqlite';
const feed=(items=[['one','first']])=>`<rss><channel>${items.map(([id,text,date])=>`<item><guid>${id}</guid><title>${id}</title><description><![CDATA[${text}]]></description>${date?`<pubDate>${date}</pubDate>`:''}</item>`).join('')}</channel></rss>`;
const response=(body=feed(),status=200,etag='"v1"')=>({status,headers:{'content-type':'application/rss+xml',...(etag?{etag}:{})},body});
async function setup(t,{scope='public',v3=true}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'watch-tests-')),dataDir=path.join(root,'state'),connections=[];
  let time=Date.parse(AT);const clock=()=>new Date(time).toISOString(),queue=[],calls=[];
  t.after(()=>{for(const m of connections)if(m.db.open)m.close();fs.rmSync(root,{recursive:true,force:true});});
  let m=openMemory({dataDir,scope,init:true,clock});connections.push(m);const imported=m.importBundle(path.join(ROOT,'research/e0-node-sqlite'));m.close();
  await migrateToV2({dataDir,scope,backup:path.join(root,'v1.sqlite'),clock});
  const a=openAnalysis({dataDir,scope,write:true,clock});connections.push(a.memory);
  const linked=a.link({left:{kind:'claim',id:imported.bundle,claim:'c1'},right:{kind:'claim',id:imported.bundle,claim:'c2'},brief:BRIEF,relation:'NOT_COMPARABLE',subject:{id:'node',label:'Node',context:'Different documented properties'},actor:'fixture',rationale:'Preserve original E3 history.'});
  a.review(linked.id,{decision:'WITHDRAWN',actor:'fixture',rationale:'Fixture history retained.'});a.close();
  const backup=path.join(root,'v2.sqlite');if(v3)await migrateToV3({dataDir,scope,backup,clock});
  const deps={harness:{token:'',lookup:async()=>[{address:'8.8.8.8',family:4}],sleep:async()=>{},wire:async(url,o)=>{calls.push({url:url.href,...o});const next=queue.shift();if(typeof next==='function')return next(url,o);if(!next)throw Error('No fixture');return next;}}};
  const open=()=>{const w=openWatch({dataDir,scope,write:true,clock},deps);connections.push(w.memory);return w;};
  return {root,dataDir,backup,scope,clock,queue,calls,deps,linked,open,w:v3?open():null,set:ms=>{time=typeof ms==='string'?Date.parse(ms):ms;},tick:ms=>{time+=ms;},now:()=>time};
}
const spec=(extra={})=>({name:'news',source:'rss',url:URL_FEED,interval:'1h',brief:BRIEF,config:{allowedHosts:['feeds.example.com','api.github.com'],feeds:[URL_FEED],limits:{minIntervalMs:0,retries:0}},...extra});
const kinds=r=>r.events.map(e=>e.kind);

test('v2→v3 real migration preserves E3 withdrawn reviews and exact v0; v2 backup is old-code-readable rollback',async t=>{
  const c=await setup(t),m=c.w.memory;assert.equal(m.doctor().schema,3);assert.equal(c.w.analysis.getLink(c.linked.id).reviews[0].decision,'WITHDRAWN');
  assert.equal((await migrateToV3({dataDir:c.dataDir,scope:c.scope})).changed,false);
  assert.throws(()=>openAnalysis({dataDir:c.dataDir,scope:c.scope}),/FUTURE_SCHEMA/);
  const rollback=path.join(c.root,'rollback');restoreMemory(c.backup,{dataDir:rollback,scope:c.scope,supportedVersion:2});
  const old=openAnalysis({dataDir:rollback,scope:c.scope});try{assert.equal(old.getLink(c.linked.id).reviews.length,1);}finally{old.close();}
  const out=path.join(c.root,BRIEF);m.exportBundle(BRIEF,out);
  for(const row of m.db.prepare('SELECT path,bytes FROM artifacts').all())assert.deepEqual(fs.readFileSync(path.join(out,row.path)),row.bytes);
});
test('v3 migration requires v2+backup; busy/failing migration rolls back, refuses overwrite, future and schema drift',async t=>{
  const c=await setup(t,{v3:false}),m=openMemory({dataDir:c.dataDir,scope:c.scope,write:true,supportedVersion:2});t.after(()=>{if(m.db.open)m.close();});
  const f=fingerprint(m.db);await assert.rejects(migrateToV3({dataDir:c.dataDir,scope:c.scope}),/MIGRATION_BACKUP_REQUIRED/);
  m.db.exec('BEGIN IMMEDIATE');await assert.rejects(migrateToV3({dataDir:c.dataDir,scope:c.scope,backup:c.backup,timeout:25}),/BUSY/);m.db.exec('ROLLBACK');
  await assert.rejects(migrateToV3({dataDir:c.dataDir,scope:c.scope,backup:c.backup,migrationSQL:'CREATE TABLE broken(x); SELECT * FROM missing_table;'}),/STORAGE_ERROR/);
  assert.equal(fingerprint(m.db),f);await assert.rejects(migrateToV3({dataDir:c.dataDir,scope:c.scope,backup:c.backup}),/TARGET_EXISTS/);m.close();
  await migrateToV3({dataDir:c.dataDir,scope:c.scope,backup:path.join(c.root,'valid.sqlite')});
  const raw=new Database(dataPath(c.dataDir,c.scope));raw.pragma('user_version=4');raw.close();assert.throws(()=>c.open(),/FUTURE_SCHEMA/);
  const drift=new Database(dataPath(c.dataDir,c.scope));drift.pragma('user_version=3');drift.exec('DROP INDEX watch_due');drift.close();assert.throws(()=>c.open(),/SCHEMA_MISMATCH/);
});
test('fresh watches DISABLED, add/list/show/enable do zero network; manual check works disabled; removal archives history',async t=>{
  const c=await setup(t),a=c.w.add(spec());assert.equal(a.state,'DISABLED');assert.equal(c.w.add(spec()).duplicate,true);assert.equal(c.calls.length,0);
  assert.equal(c.w.list().watches.length,1);c.w.control(a.id,'ENABLE');assert.equal(c.calls.length,0);c.w.control(a.id,'DISABLE');
  c.queue.push(response());const r=await c.w.run(a.id);assert.ok(kinds(r).includes('NEW'));assert.equal(c.w.show(a.id).state,'DISABLED');
  c.w.control(a.id,'REMOVE');assert.equal(c.w.show(a.id).state,'REMOVED');assert.equal(c.w.history(a.id).attempts.length,1);await assert.rejects(c.w.run(a.id),/WATCH_REMOVED/);
  assert.equal((await c.w.due()).results.length,0);
});
test('RSS manual NEW/CHANGED/SAME and own validated 304 preserve both pointers, cached membership and no duplicate reports',async t=>{
  const c=await setup(t),w=c.w.add(spec());c.queue.push(response());const first=await c.w.run(w.id,{key:'first'});
  assert.equal(first.emitted,true);const calls=c.calls.length;assert.equal((await c.w.run(w.id,{key:'first'})).duplicate,true);assert.equal(c.calls.length,calls);
  c.tick(1000);c.queue.push(response(feed([['one','changed']]),200,'"v2"'));const changed=await c.w.run(w.id);assert.ok(kinds(changed).includes('CHANGED'));assert.ok(changed.events[0].left.checkId);assert.ok(changed.events[0].right.revisionId);
  c.tick(1000);c.queue.push(response(feed([['one','changed']]),200,'"v2"'));const same=await c.w.run(w.id);assert.deepEqual(kinds(same),['SAME']);assert.equal(same.emitted,false);
  c.tick(1000);c.queue.push(response('',304,null));const conditional=await c.w.run(w.id);assert.deepEqual(kinds(conditional),['NOT_MODIFIED']);assert.equal(conditional.emitted,false);assert.ok(conditional.events[0].validatedBy);
  assert.equal(c.calls.at(-1).headers['If-None-Match']||c.calls.at(-1).headers['if-none-match'],'"v2"');assert.equal(c.w.history(w.id).deliveries.length,2);
});
test('RSS fully enumerated omission is only candidate, partial omission unknown, empty feed 304 does not resurrect old members',async t=>{
  const c=await setup(t),w=c.w.add(spec());c.queue.push(response(feed([['one','a'],['two','b']])));await c.w.run(w.id);
  c.tick(1000);c.queue.push(response(feed([['one','a']]),200,'"v2"'));const omitted=await c.w.run(w.id);assert.ok(kinds(omitted).includes('REMOVED_OR_UNAVAILABLE'));assert.equal(omitted.events.find(e=>e.kind==='REMOVED_OR_UNAVAILABLE').absence,'NOT_PROVEN');
  c.tick(1000);c.queue.push(response(feed([]),200,'"empty"'));await c.w.run(w.id);
  c.tick(1000);c.queue.push(response('',304,null));const cached=await c.w.run(w.id);assert.deepEqual(kinds(cached),['NOT_MODIFIED']);assert.ok(cached.events[0].identity.startsWith('target:'));
});
test('304 cannot borrow a newer unrelated capped feed acquisition or stale/missing validator; invalid dates retain good cursor',async t=>{
  const c=await setup(t),w=c.w.add(spec());const full=feed([['one','a'],['two','b']]);c.queue.push(response(full));const initial=await c.w.run(w.id);
  c.w.add(spec({name:'other',config:{allowedHosts:['feeds.example.com'],feeds:[URL_FEED],limits:{maxResults:1,minIntervalMs:0,retries:0}}}));
  c.tick(1000);c.queue.push(response(full));await c.w.run('other');
  c.tick(1000);c.queue.push(response('',304));const cached=await c.w.run(w.id);assert.equal(cached.events.filter(e=>e.kind==='NOT_MODIFIED').length,2);
  c.tick(1000);c.queue.push(response('',304,'"stale"'));const stale=await c.w.run(w.id);assert.ok(kinds(stale).includes('STILL_UNKNOWN'));assert.equal(c.w.show(w.id).lastGoodRun,initial.runId);
  c.tick(1000);c.queue.push(response(feed([['one','new','invalid-date']]),200,'"bad-date"'));const invalid=await c.w.run(w.id);assert.ok(invalid.events.some(e=>e.reason==='INVALID_OR_OUT_OF_ORDER_SOURCE_DATE'));assert.equal(c.w.show(w.id).lastGoodRun,initial.runId);
});
test('GitHub bounded search compares per-repository metadata through E3 and never infers disappearance; pinned audit explicit',async t=>{
  const c=await setup(t),w=c.w.add(spec({source:'github',url:undefined,query:'plain',name:'github'}));
  const gh=(items)=>({status:200,headers:{'content-type':'application/json'},body:JSON.stringify({items})});
  const repo={id:1,private:false,full_name:'owner/repo',created_at:AT,updated_at:AT};
  c.queue.push(gh([repo]));assert.ok(kinds(await c.w.run(w.id)).includes('NEW'));
  c.tick(1000);c.queue.push(gh([{...repo,updated_at:'2026-10-31T01:00:00Z'}]));assert.ok(kinds(await c.w.run(w.id)).includes('CHANGED'));
  c.tick(1000);c.queue.push(gh([]));const missing=await c.w.run(w.id);assert.ok(kinds(missing).includes('STILL_UNKNOWN'));assert.equal(kinds(missing).includes('REMOVED_OR_UNAVAILABLE'),false);
  assert.throws(()=>c.w.add(spec({name:'pin',source:'github',url:undefined,repo:'owner/repo',ref:'a'.repeat(40)})),/PINNED_AUDIT_REQUIRED/);
  assert.equal(c.w.add(spec({name:'pin',source:'github',url:undefined,repo:'owner/repo',ref:'a'.repeat(40),mode:'pinned-audit'})).state,'DISABLED');
});
test('403/404/429/timeout and cancellation retain baseline; repeated failures emit no duplicate reports',async t=>{
  const c=await setup(t),w=c.w.add(spec());c.queue.push(response());const first=await c.w.run(w.id);
  for(const status of [401,403,404,429,503]){c.tick(61000);c.queue.push(response('',status,null));const r=await c.w.run(w.id);assert.equal(r.baselineRun,first.runId);assert.ok(r.events.every(e=>!['NEW','CHANGED'].includes(e.kind)));}
  c.tick(1000);c.queue.push(response('',503,null));assert.equal((await c.w.run(w.id)).emitted,false);
  const controller=new AbortController();controller.abort();c.tick(1000);const cancelled=await c.w.run(w.id,{signal:controller.signal});assert.equal(cancelled.acquisitionStatus,'CANCELLED');assert.equal(cancelled.baselineRun,first.runId);
});
test('UTC fixed intervals survive DST/timezone, coalesce missed windows, deterministic capped backoff and backward clock',async t=>{
  const c=await setup(t);c.set('2026-11-01T05:30:00.000Z');const w=c.w.add(spec({timezone:'America/New_York'}));c.w.control(w.id,'ENABLE');
  c.queue.push(response());const first=(await c.w.due()).results[0];assert.equal(first.nextDueAt,'2026-11-01T06:30:00.000Z');
  c.tick(10*3600000);c.queue.push(response());const missed=(await c.w.due()).results;assert.equal(missed.length,1);assert.equal(missed[0].nextDueAt,'2026-11-01T16:30:00.000Z');
  c.set('2026-11-01T04:00:00.000Z');const calls=c.calls.length;assert.equal((await c.w.run(w.id)).status,'CLOCK_SKEW');assert.equal(c.calls.length,calls);
  assert.equal(retryDelay(w.id,3,3600000),retryDelay(w.id,3,3600000));assert.ok(retryDelay(w.id,100,3600000)<=86400000*1.1);
  assert.throws(()=>c.w.add(spec({name:'bad-zone',timezone:'not/a-zone'})),/INVALID_TIMEZONE/);
});
test('finite due checker requires enabled watches and respects serial concurrency/global request budget; disable prevents polling',async t=>{
  const c=await setup(t),one=c.w.add(spec()),two=c.w.add(spec({name:'second'}));assert.equal((await c.w.due()).results.length,0);
  c.w.control(one.id,'ENABLE');c.w.control(two.id,'ENABLE');c.queue.push(response());const batch=await c.w.due({maxRequests:12});assert.equal(batch.concurrency,1);assert.equal(batch.results.length,2);assert.ok(batch.results.some(r=>r.skipped==='REQUEST_BUDGET'));assert.equal(c.calls.length,1);
  c.w.control(one.id,'DISABLE');c.w.control(two.id,'DISABLE');c.tick(86400000);assert.equal((await c.w.due()).results.length,0);
});
test('independent connections serialize leases; expired crash recovery fences stale commit; disable fences in-flight fetch',async t=>{
  const c=await setup(t),w=c.w.add(spec()),other=c.open();
  const held=c.w.claim(w.id,{key:'crashed'});assert.throws(()=>other.claim(w.id),/WATCH_BUSY/);
  c.tick(3600000);c.queue.push(response());const recovered=await other.run(w.id,{key:'crashed'});assert.ok(recovered.runId);
  const result={version:1,adapter:'rss',status:'OK',observations:[],limitations:[],requests:0,trace:[],request:{operation:'retrieve',url:URL_FEED}};
  assert.throws(()=>c.w.finish(held,result,{}),/LEASE_LOST/);assert.equal(c.w.history(w.id).attempts[0].status,'ABANDONED');
  const active=c.w.claim(w.id);other.control(w.id,'DISABLE');assert.throws(()=>c.w.finish(active,result,{}),/LEASE_LOST/);
});
test('crash after DB commit and after local files recovers one report/receipt without duplicate delta or overwrite',async t=>{
  const c=await setup(t),w=c.w.add(spec());c.queue.push(response());c.deps.afterCommit=()=>{throw Error('simulated crash after commit');};
  await assert.rejects(c.w.run(w.id),/simulated crash/);delete c.deps.afterCommit;
  const row=c.w.history(w.id).deliveries[0];assert.equal(row.status,'PENDING');
  c.deps.beforeReceipt=()=>{throw Error('simulated crash before receipt');};assert.throws(()=>c.w.deliver(row.id),/simulated crash/);delete c.deps.beforeReceipt;
  c.w.close();const reopened=c.open();assert.equal(reopened.deliver(row.id).delivery,'DELIVERED');assert.equal(reopened.deliver(row.id).verified,true);
  assert.equal(reopened.db.prepare('SELECT count(*) n FROM watch_receipts').get().n,1);assert.equal(reopened.db.prepare('SELECT count(*) n FROM watch_deltas').get().n,1);
  const reportPath=path.join(reopened.get(w.id).definition.outputRoot,row.id,'REPORT.md');fs.writeFileSync(reportPath,'unrelated replacement');assert.throws(()=>reopened.deliver(row.id),/REPORT_CONTENT_MISMATCH/);
});
test('private output requires explicit opt-in; inert reports, secret/SSRF/provider/config rejection and immutable watch audits',async t=>{
  const c=await setup(t,{scope:'private'}),w=c.w.add(spec());c.queue.push(response(feed([['one','<script>bad()</script> ` data']])));const r=await c.w.run(w.id);
  assert.throws(()=>c.w.deliver(r.reportId),/PRIVATE_EXPORT_REQUIRED/);c.w.deliver(r.reportId,{allowPrivate:true});
  const report=c.w.report(r.reportId).report;assert.equal(JSON.stringify(report).includes('<script>'),false);
  assert.throws(()=>c.w.add(spec({name:'secret',actor:'Bearer syntheticToken123456'})),/SECRET_REJECTED/);
  assert.throws(()=>c.w.add(spec({name:'ssrf',url:'https://127.0.0.1/'})),/UNSAFE_URL/);
  assert.throws(()=>c.w.add(spec({name:'web',source:'web',url:undefined})),/NO_PROVIDER_NO_CREDENTIALS/);
  assert.throws(()=>c.w.add(spec({interval:'0s'})),/INVALID_INTERVAL/);
  assert.throws(()=>c.w.add(spec({interval:'2h'})),/IDEMPOTENCY_CONFLICT/);
  assert.throws(()=>c.w.db.exec('DELETE FROM watch_deltas'),/immutable/);
  assert.throws(()=>c.w.db.exec('UPDATE watch_definitions SET name=\'rewritten\''),/immutable/);
});
test('partial cap/duplicate RSS/out-of-order source observations never claim deletion or advance complete cursor',async t=>{
  const c=await setup(t),w=c.w.add(spec({config:{allowedHosts:['feeds.example.com'],feeds:[URL_FEED],limits:{maxResults:2,minIntervalMs:0,retries:0}}}));
  c.queue.push(response(feed([['one','a'],['two','b']])));const first=await c.w.run(w.id);
  c.tick(1000);c.queue.push(response(feed([['one','a'],['one','duplicate'],['three','c'],['four','d']]),200,'"partial"'));const r=await c.w.run(w.id);
  assert.ok(kinds(r).includes('STILL_UNKNOWN'));assert.equal(kinds(r).includes('REMOVED_OR_UNAVAILABLE'),false);assert.equal(r.baselineRun,first.runId);
  const stored=c.w.get(w.id);assert.equal(stored.validators.etag,'"v1"');
});
test('v3 backup/restart preserves watch definitions, pending deliveries and E3 ledger; row quota rolls back run data',async t=>{
  const c=await setup(t),w=c.w.add(spec());c.queue.push(response());const r=await c.w.run(w.id);
  const backup=path.join(c.root,'v3.sqlite');await c.w.memory.backup(backup);const dest=path.join(c.root,'restored');restoreMemory(backup,{dataDir:dest,scope:c.scope,supportedVersion:3});
  const restored=openWatch({dataDir:dest,scope:c.scope});try{assert.equal(restored.show(w.id).state,'DISABLED');assert.equal(restored.report(r.reportId).delivery,'PENDING');assert.equal(restored.analysis.getLink(c.linked.id).reviews.length,1);}finally{restored.close();}
  c.w.memory.maxRecords=1;const before=c.w.db.prepare('SELECT count(*) n FROM runs').get().n;c.tick(1000);c.queue.push(response(feed([['one','new']])));await assert.rejects(c.w.run(w.id),/QUOTA/);assert.equal(c.w.db.prepare('SELECT count(*) n FROM runs').get().n,before);
});
test('CLI help/strict once/finite network opt-in and readonly missing state do not create DB or OS task',async t=>{
  const c=await setup(t),invoke=args=>spawnSync(process.execPath,['tools/research-watch.mjs',...args],{cwd:ROOT,encoding:'utf8',timeout:15000});
  assert.equal(invoke(['--help']).status,0);assert.equal(invoke(['due','--once']).status,2);assert.equal(invoke(['scheduler','--foreground']).status,2);
  const absent=path.join(c.root,'absent');assert.equal(invoke(['list','--data-dir',absent,'--json']).status,1);assert.equal(fs.existsSync(absent),false);
  assert.equal(invoke(['run','id']).status,2);assert.equal(c.calls.length,0);
});
test('separate worker processes cannot both claim; killed process lease recovers without duplicate committed event',async t=>{
  const c=await setup(t),w=c.w.add(spec()),worker=path.join(ROOT,'tests/helpers/watch-worker.mjs');
  const launch=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[worker,c.dataDir,w.id,AT,'once'],{cwd:ROOT,windowsHide:true});let stdout='',stderr='';
    const timer=setTimeout(()=>{child.kill();reject(Error('worker timeout'));},15000);
    child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('exit',status=>{clearTimeout(timer);resolve({status,stdout,stderr});});
  });
  const results=await Promise.all([launch(),launch()]);assert.deepEqual(results.map(r=>JSON.parse(r.stdout).status).sort(),['CLAIMED','WATCH_BUSY']);
  c.tick(3600000);const held=spawn(process.execPath,[worker,c.dataDir,w.id,c.clock(),'hold'],{cwd:ROOT,windowsHide:true});
  t.after(()=>held.kill());let output='';await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('no ready')),15000);held.stdout.on('data',b=>{output+=b;if(output.includes('\n')){clearTimeout(timer);resolve();}});held.on('error',reject);});
  assert.equal(JSON.parse(output).status,'CLAIMED');const dead=new Promise(resolve=>held.once('exit',resolve));held.kill('SIGKILL');await dead;
  c.tick(3600000);c.queue.push(response());const recovered=await c.w.run(w.id);assert.ok(kinds(recovered).includes('NEW'));
  assert.equal(c.w.db.prepare('SELECT count(*) n FROM watch_deltas').get().n,1);assert.ok(c.w.history(w.id).attempts.filter(r=>r.status==='ABANDONED').length>=2);
});
test('real E1 timeout and cancellation during request preserve the cursor; private DNS/redirect requests are rejected',async t=>{
  const c=await setup(t),w=c.w.add(spec({config:{allowedHosts:['feeds.example.com'],feeds:[URL_FEED],limits:{timeoutMs:20,retries:0,minIntervalMs:0}}}));
  c.queue.push(response());const baseline=await c.w.run(w.id);
  c.tick(1000);c.queue.push(()=>new Promise(()=>{}));const timeout=await c.w.run(w.id);assert.equal(timeout.acquisitionStatus,'TIMEOUT');assert.equal(timeout.baselineRun,baseline.runId);
  const controller=new AbortController();c.tick(1000);c.queue.push(()=>{controller.abort();return response();});assert.equal((await c.w.run(w.id,{signal:controller.signal})).acquisitionStatus,'CANCELLED');
  c.tick(1000);const calls=c.calls.length;c.deps.harness.lookup=async()=>[{address:'127.0.0.1',family:4}];const denied=await c.w.run(w.id);assert.notEqual(denied.acquisitionStatus,'OK');assert.equal(c.calls.length,calls);
  c.deps.harness.lookup=async()=>[{address:'8.8.8.8',family:4}];c.tick(1000);c.queue.push({status:302,headers:{location:'http://127.0.0.1/'},body:''});assert.notEqual((await c.w.run(w.id)).acquisitionStatus,'OK');
  assert.equal(c.w.show(w.id).lastGoodRun,baseline.runId);
});
test('source retrieval clock moving backward mid-fetch is UNKNOWN, not a historical overwrite',async t=>{
  const c=await setup(t),w=c.w.add(spec());c.queue.push(response());const first=await c.w.run(w.id);
  c.tick(1000);c.queue.push(()=>{c.set(Date.parse(AT)-1000);return response(feed([['one','older data']]));});
  const skew=await c.w.run(w.id);assert.equal(skew.status,'CLOCK_SKEW');assert.equal(skew.baselineRun,first.runId);assert.ok(skew.events.every(e=>!['NEW','CHANGED'].includes(e.kind)));
});
test('unexpected or missing-validator 304 never invents a baseline; partial new content invalidates stale conditional cursor',async t=>{
  const c=await setup(t),w=c.w.add(spec({config:{allowedHosts:['feeds.example.com'],feeds:[URL_FEED],limits:{maxResults:1,minIntervalMs:0,retries:0}}}));
  c.queue.push(response('',304,null));const unknown=await c.w.run(w.id);assert.equal(unknown.baselineRun,null);assert.ok(kinds(unknown).includes('STILL_UNKNOWN'));
  c.tick(1000);c.queue.push(response(feed([['one','a']])));await c.w.run(w.id);
  c.tick(1000);c.queue.push(response(feed([['one','new'],['two','capped']]),200,'"new"'));await c.w.run(w.id);assert.deepEqual(c.w.get(w.id).validators,{});
  c.tick(1000);c.queue.push(response('',304,null));assert.ok(kinds(await c.w.run(w.id)).includes('STILL_UNKNOWN'));
});
test('owned partial report publication resumes; unrelated directories and symlinked roots are never overwritten',async t=>{
  const c=await setup(t),w=c.w.add(spec());c.queue.push(response());const r=await c.w.run(w.id);const root=c.w.get(w.id).definition.outputRoot,output=path.join(root,r.reportId);
  fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'unrelated.txt'),'keep');assert.throws(()=>c.w.deliver(r.reportId),/TARGET_EXISTS/);assert.equal(fs.readFileSync(path.join(output,'unrelated.txt'),'utf8'),'keep');
  // Remove only this test's known directory, then exercise resumable ownership.
  fs.rmSync(output,{recursive:true});c.w.deliver(r.reportId);fs.unlinkSync(path.join(output,'report.json'));assert.equal(c.w.deliver(r.reportId).verified,true);
  const target=path.join(c.root,'target'),link=path.join(c.root,'link');fs.mkdirSync(target);fs.symlinkSync(target,link,'junction');assert.throws(()=>c.w.add(spec({name:'symlink',out:link})),/SYMLINK_REJECTED/);
});
test('secret source bytes abort the acquisition transaction; pending-report quota blocks further network without loss',async t=>{
  const c=await setup(t),w=c.w.add(spec({maxPending:2}));c.queue.push(response());const first=await c.w.run(w.id);
  c.tick(1000);c.queue.push(response(feed([['one','Bearer syntheticSensitiveCredential987654']])));await assert.rejects(c.w.run(w.id),/SECRET_REJECTED/);
  assert.equal(JSON.stringify(c.w.history(w.id)).includes('syntheticSensitiveCredential'),false);assert.equal(c.w.show(w.id).lastGoodRun,first.runId);
  c.tick(1000);c.queue.push(response(feed([['one','second']]),200,'"second"'));await c.w.run(w.id);const calls=c.calls.length;
  await assert.rejects(c.w.run(w.id),/QUOTA/);assert.equal(c.calls.length,calls);assert.equal(c.w.history(w.id).deliveries.length,2);
});
test('provider Retry-After survives restart and applies across watches on the same allowed origin',async t=>{
  const c=await setup(t),w=c.w.add(spec()),other=c.w.add(spec({name:'other'}));c.w.control(w.id,'ENABLE');
  c.queue.push({status:429,headers:{'content-type':'application/rss+xml','retry-after':'3600'},body:''});const failed=await c.w.run(w.id);assert.ok(Date.parse(failed.nextDueAt)>=c.now()+3600000);
  c.w.close();const reopened=c.open(),calls=c.calls.length;assert.equal((await reopened.run(other.id)).status,'RETRY_NOT_DUE');assert.equal(c.calls.length,calls);
  c.tick(3600001);c.queue.push(response());assert.ok(kinds(await reopened.run(other.id)).includes('NEW'));
});
