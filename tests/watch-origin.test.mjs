import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {identity} from '../analysis/records.mjs';
import {restoreMemory} from '../memory/store.mjs';
import {fingerprint} from '../memory/schema.mjs';
import {openWatch} from '../watch/store.mjs';
import {setup,spec,response,AT} from './helpers/friday-store.mjs';
const next='2026-10-31T13:00:00.000Z';
const slot=(w,due)=>`due-v2:${identity([w.id,w.activationId,due])}`;
// Historical fixture insertion only; never edit/delete existing audit records.
function legacy(c,w,source,{key,scheduled=false,activationId=null,dueAt=null,resultSchedule=null,events=1,old=false}){
  const row=c.w.db.prepare('SELECT * FROM watch_attempts WHERE id=?').get(source.attempt),id=identity(randomUUID()),result={...source,attempt:id,schedule:resultSchedule};
  if(old)delete result.schedule;
  c.w.db.prepare('INSERT INTO watch_attempts VALUES (?,?,?,?,?,?,?,?,?)').run(id,w.id,key,row.started_at,row.finished_at,'COMPLETED',row.lease_token,row.run_id,JSON.stringify(result));
  for(let i=0;i<events;i++)c.w.event(w.id,'CHECK_START',{attempt:id,scheduled,leaseMs:60000,...(old?{}:{activationId,dueAt})},row.started_at);
  return id;
}
const row=(c,id)=>c.w.db.prepare('SELECT * FROM watch_attempts WHERE id=?').get(id);

test('origin: scheduled→manual collision executes a manual acquisition then replays only that manual receipt',async t=>{
  const c=await setup(t),a=c.w.add(spec({out:path.join(c.root,'reports')})),enabled=c.w.control(a.id,'ENABLE'),key=slot(enabled,AT);
  c.queue.push(response());const scheduled=(await c.w.due({write:true})).results[0];
  c.queue.push(response());const manual=await c.w.run(a.id,{key,write:true});assert.equal(manual.duplicate,undefined);assert.equal(manual.schedule,null);assert.notEqual(manual.attempt,scheduled.attempt);
  const replay=await c.w.run(a.id,{key,write:true});assert.equal(replay.duplicate,true);assert.equal(replay.attempt,manual.attempt);assert.equal(c.calls.length,2);assert.equal(c.w.db.prepare('SELECT count(*) n FROM watch_receipts').get().n,1);
});

test('origin: legacy manual due-v2 key survives and cannot poison scheduled replay, even behind a newer scheduled row',async t=>{
  const c=await setup(t),a=c.w.add(spec()),enabled=c.w.control(a.id,'ENABLE'),key=slot(enabled,next);
  c.queue.push(response());const manual=await c.w.run(a.id,{key:'initial'}),id=legacy(c,a,manual,{key,old:true}),before=row(c,id);
  c.w.close();const worker=c.open();c.w=worker;c.set(next);c.queue.push(response());const due=(await worker.due()).results[0];assert.equal(due.duplicate,undefined);assert.ok(due.nextDueAt>next);
  const replay=await worker.run(a.id,{key});assert.equal(replay.attempt,id);assert.equal(replay.duplicate,true);assert.equal(c.calls.length,2);assert.deepEqual(row(c,id),before);
});

test('origin: missing legacy provenance is retained but refreshed once, then the new manual completion replays',async t=>{
  const c=await setup(t),a=c.w.add(spec());c.queue.push(response());const first=await c.w.run(a.id),id=legacy(c,a,first,{key:'unknown',events:0,old:true}),before=row(c,id);
  c.queue.push(response());const fresh=await c.w.run(a.id,{key:'unknown'});assert.notEqual(fresh.attempt,id);assert.equal(fresh.duplicate,undefined);
  assert.equal((await c.w.run(a.id,{key:'unknown'})).attempt,fresh.attempt);assert.equal(c.calls.length,2);assert.deepEqual(row(c,id),before);
});

test('origin: writable result schedule cannot turn an immutable manual CHECK_START into scheduled provenance',async t=>{
  const c=await setup(t),a=c.w.add(spec()),enabled=c.w.control(a.id,'ENABLE'),key=slot(enabled,next);c.queue.push(response());const first=await c.w.run(a.id);
  const id=legacy(c,a,first,{key,resultSchedule:{activationId:enabled.activationId,dueAt:next}}),before=row(c,id);
  c.set(next);c.queue.push(response());const due=(await c.w.due()).results[0];assert.equal(due.duplicate,undefined);assert.notEqual(due.attempt,id);assert.deepEqual(row(c,id),before);
});

test('origin: old scheduled rows without epoch/slot never replay as manual or as an unproven current slot',async t=>{
  const c=await setup(t),a=c.w.add(spec()),enabled=c.w.control(a.id,'ENABLE');c.queue.push(response());const first=await c.w.run(a.id);
  const id=legacy(c,a,first,{key:'old-scheduled',scheduled:true,old:true});c.queue.push(response());const manual=await c.w.run(a.id,{key:'old-scheduled'});assert.notEqual(manual.attempt,id);
  const dueId=legacy(c,a,first,{key:slot(enabled,next),scheduled:true,old:true});c.set(next);c.queue.push(response());const due=(await c.w.due()).results[0];assert.notEqual(due.attempt,dueId);assert.equal(due.duplicate,undefined);
});

test('origin: conflicting immutable CHECK_START records are ambiguous and do not establish manual origin',async t=>{
  const c=await setup(t),a=c.w.add(spec());c.queue.push(response());const first=await c.w.run(a.id),id=legacy(c,a,first,{key:'ambiguous',events:2}),before=row(c,id);
  c.queue.push(response());const fresh=await c.w.run(a.id,{key:'ambiguous'});assert.notEqual(fresh.attempt,id);assert.equal((await c.w.run(a.id,{key:'ambiguous'})).attempt,fresh.attempt);assert.deepEqual(row(c,id),before);
});

test('origin: stale activation or wrong due slot in start/result cannot satisfy a current scheduled key',async t=>{
  for(const wrong of ['activation','slot']){
    const c=await setup(t),a=c.w.add(spec()),old=c.w.control(a.id,'ENABLE');c.queue.push(response());const first=await c.w.run(a.id);
    c.w.control(a.id,'DISABLE');const current=c.w.control(a.id,'ENABLE'),activationId=wrong==='activation'?old.activationId:current.activationId,dueAt=wrong==='slot'?next:AT;
    const id=legacy(c,a,first,{key:slot(current,AT),scheduled:true,activationId,dueAt,resultSchedule:{activationId,dueAt}});
    c.queue.push(response());const due=(await c.w.due()).results[0];assert.notEqual(due.attempt,id);assert.equal(due.duplicate,undefined);assert.equal(due.schedule.activationId,current.activationId);
  }
});

test('origin: concurrent due workers ignore a completed manual collision, honor lease and commit one slot',async t=>{
  const c=await setup(t),a=c.w.add(spec()),enabled=c.w.control(a.id,'ENABLE'),key=slot(enabled,next);c.queue.push(response());const manual=await c.w.run(a.id,{key});
  c.set(next);const other=c.open();let release;const wait=new Promise(r=>{release=r;});c.queue.push(async()=>{await wait;return response();});
  const pending=c.w.due();assert.equal((await other.due()).results[0].status,'WATCH_BUSY');release();const completed=(await pending).results[0];assert.notEqual(completed.attempt,manual.attempt);assert.equal((await other.due()).results.length,0);
  assert.equal((await other.run(a.id,{key})).attempt,manual.attempt);assert.equal(c.calls.length,2);assert.equal(other.history(a.id).attempts.length,2);
});

test('origin: v3 backup/new-root restore retains legacy collision history, manual receipt and scheduled origin',async t=>{
  const c=await setup(t),a=c.w.add(spec({out:path.join(c.root,'reports')})),enabled=c.w.control(a.id,'ENABLE'),key=slot(enabled,next);c.queue.push(response());const manual=await c.w.run(a.id,{key,write:true});
  const before=row(c,manual.attempt),schema=fingerprint(c.w.db),backup=path.join(c.root,'origin.sqlite'),restored=path.join(c.root,'restored');await c.w.memory.backup(backup);restoreMemory(backup,{dataDir:restored,scope:'public',supportedVersion:3});c.set(next);
  const worker=openWatch({dataDir:restored,scope:'public',write:true,clock:c.clock},{harness:c.harness});c.track(worker.memory);c.queue.push(response());const scheduled=(await worker.due()).results[0];assert.equal(scheduled.duplicate,undefined);assert.equal((await worker.due()).results.length,0);
  assert.equal((await worker.run(a.id,{key,write:true})).attempt,manual.attempt);assert.equal(worker.db.prepare('SELECT count(*) n FROM watch_receipts').get().n,1);assert.equal(fingerprint(worker.db),schema);
  assert.deepEqual(worker.db.prepare('SELECT * FROM watch_attempts WHERE id=?').get(manual.attempt),before);assert.equal(c.calls.length,2);assert.equal(worker.memory.doctor().schema,3);worker.control(a.id,'DISABLE');
});
