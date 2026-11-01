import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {restoreMemory} from '../memory/store.mjs';
import {openWatch} from '../watch/store.mjs';
import {fingerprint} from '../memory/schema.mjs';
import {setup,spec,response,AT,A} from './helpers/friday-store.mjs';

test('P2 equal-clock enable cycles have durable distinct epochs and execute one new check per due slot across restart',async t=>{
  const c=await setup(t),w=c.w.add(spec()),epochs=new Set(),attempts=new Set();let worker=c.w;
  for(let i=0;i<5;i++){
    const enabled=worker.control(w.id,'ENABLE');assert.ok(enabled.activationId);assert.equal(epochs.has(enabled.activationId),false);epochs.add(enabled.activationId);
    worker.close();worker=c.open();assert.equal(worker.show(w.id).activationId,enabled.activationId);
    c.queue.push(response());const r=(await worker.due()).results[0];assert.equal(r.duplicate,undefined);assert.equal(r.schedule.activationId,enabled.activationId);attempts.add(r.attempt);
    assert.equal(worker.show(w.id).nextDueAt,r.nextDueAt);assert.equal((await worker.due()).results.length,0);worker.control(w.id,'DISABLE');
  }
  assert.equal(c.calls.length,5);assert.equal(attempts.size,5);assert.equal(worker.history(w.id).attempts.length,5);assert.equal(worker.history(w.id).deliveries.length,1);
});

test('P2 enable on already enabled watch preserves future schedule/epoch/lease and performs no HTTP',async t=>{
  const c=await setup(t),w=c.w.add(spec()),enabled=c.w.control(w.id,'ENABLE');c.queue.push(response());const r=(await c.w.due()).results[0];
  const again=c.w.control(w.id,'ENABLE');assert.equal(again.activationId,enabled.activationId);assert.equal(again.nextDueAt,r.nextDueAt);assert.equal((await c.w.due()).results.length,0);
  c.set(r.nextDueAt);const claim=c.w.claim(w.id,{scheduled:true});const lease=c.w.get(w.id).lease_token;c.w.control(w.id,'ENABLE');assert.equal(c.w.get(w.id).lease_token,lease);assert.equal(c.w.fenced(claim).activationId,enabled.activationId);assert.equal(c.calls.length,1);
});

test('P2 stale selected activation cannot claim equal timestamp of a new activation; old lease cannot finish',async t=>{
  const c=await setup(t),w=c.w.add(spec()),old=c.w.control(w.id,'ENABLE'),claim=c.w.claim(w.id,{scheduled:true});
  c.w.control(w.id,'DISABLE');const next=c.w.control(w.id,'ENABLE');assert.notEqual(old.activationId,next.activationId);assert.equal(old.nextDueAt,next.nextDueAt);
  assert.equal(c.w.claim(w.id,{scheduled:true,expectedDue:old.nextDueAt,expectedActivation:old.activationId}).skipped,'NOT_DUE');assert.throws(()=>c.w.fenced(claim),/LEASE_LOST/);
  assert.equal(c.calls.length,0);assert.equal(c.w.history(w.id).attempts[0].status,'CANCELLED');
});

test('P2 scheduled eligibility precedes completed lookup while manual keys retain replay and single receipt',async t=>{
  const c=await setup(t),w=c.w.add(spec({out:path.join(c.root,'reports')}));c.queue.push(response());const manual=await c.w.run(w.id,{key:'manual',write:true});
  assert.equal((await c.w.run(w.id,{scheduled:true,key:'manual'})).status,'NOT_DUE');
  c.w.control(w.id,'ENABLE');c.w.control(w.id,'DISABLE');c.w.control(w.id,'ENABLE');
  const replay=await c.w.run(w.id,{key:'manual',write:true});assert.equal(replay.duplicate,true);assert.equal(replay.runId,manual.runId);assert.equal(c.calls.length,1);
  assert.equal(c.w.db.prepare('SELECT count(*) n FROM watch_receipts').get().n,1);
  c.queue.push(response());const scheduled=(await c.w.due()).results[0];assert.notEqual(scheduled.attempt,manual.attempt);assert.equal(scheduled.emitted,false);assert.equal(c.w.history(w.id).deliveries.length,1);
});

test('P2 two connections contend on one durable activation/slot and completed schedule advances once',async t=>{
  const c=await setup(t),w=c.w.add(spec());c.w.control(w.id,'ENABLE');const other=c.open();let release;
  const blocked=new Promise(resolve=>{release=resolve;});c.queue.push(async()=>{await blocked;return response();});
  const first=c.w.due();assert.equal((await other.due()).results[0].status,'WATCH_BUSY');release();await first;
  assert.equal((await other.due()).results.length,0);assert.equal(c.calls.length,1);assert.equal(other.history(w.id).attempts.length,1);
});

test('P2 existing v3 timestamp-key history and URI survive backup/restore without schema rewrite; old loop resumes',async t=>{
  const c=await setup(t),w=c.w.add(spec());const enabled=c.w.control(w.id,'ENABLE');c.queue.push(response());const first=(await c.w.due()).results[0];
  // Recreate the vulnerable E4 persisted shape: completed timestamp-only key,
  // plus a same-clock reactivation with that slot still due. Keep all rows.
  c.w.db.prepare('UPDATE watch_attempts SET request_key=? WHERE id=?').run(`due:${AT}`,first.attempt);c.w.control(w.id,'DISABLE');const next=c.w.control(w.id,'ENABLE');
  const original=fingerprint(c.w.db),backup=path.join(c.root,'legacy.sqlite');await c.w.memory.backup(backup);const restoredDir=path.join(c.root,'restored');restoreMemory(backup,{dataDir:restoredDir,scope:'public',supportedVersion:3});
  const reopened=openWatch({dataDir:restoredDir,scope:'public',write:true,clock:c.clock},{harness:c.harness});c.track(reopened.memory);
  assert.equal(reopened.show(w.id).activationId,next.activationId);assert.equal(reopened.get(w.id).validators.uri,A);assert.equal(fingerprint(reopened.db),original);assert.equal(c.calls.length,1);
  c.queue.push(response());const current=(await reopened.due()).results[0];assert.equal(current.duplicate,undefined);assert.notEqual(current.attempt,first.attempt);assert.notEqual(next.activationId,enabled.activationId);
  assert.equal(reopened.db.prepare('SELECT request_key FROM watch_attempts WHERE id=?').get(first.attempt).request_key,`due:${AT}`);assert.equal(reopened.history(w.id).attempts.length,2);assert.equal((await reopened.due()).results.length,0);assert.equal(fingerprint(reopened.db),original);
});
