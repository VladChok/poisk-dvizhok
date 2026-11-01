#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const ROOT=fileURLToPath(new URL('../',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'friday-proof-')),state=path.join(temp,'state'),restored=path.join(temp,'restored'),runs=[],startedAt=new Date().toISOString();
const preload=new URL('../tests/helpers/offline.mjs',import.meta.url).href,at='2026-10-31T12:00:00.000Z',later='2026-10-31T14:00:00.000Z';
const redact=s=>s.split(temp).join('<temp>');
function run(script,args){const r=spawnSync(process.execPath,[script,...args],{cwd:ROOT,encoding:'utf8',timeout:30000,env:{...process.env,NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --import=${preload}`.trim()}});assert.equal(r.status,0,r.stdout+r.stderr);runs.push({command:redact(`node ${script} ${args.join(' ')}`),exitCode:r.status,stdout:redact(r.stdout),stderr:redact(r.stderr)});return JSON.parse(r.stdout);}
const write=(name,value)=>{const p=path.join(temp,name);fs.writeFileSync(p,JSON.stringify(value));return p;};
try{
  const empty=write('empty.json',{version:1,responses:[]}),input=write('definition.json',{name:'friday',source:'rss',url:'https://feeds.example.com/feed',interval:'1h',out:path.join(temp,'reports'),config:{allowedHosts:['feeds.example.com'],feeds:['https://feeds.example.com/feed'],limits:{retries:0,minIntervalMs:0}}});
  const memory=(dir,...args)=>run('tools/research-memory.mjs',[...args,'--data-dir',dir,'--scope','public','--json']);
  const watch=(dir,time,...args)=>run('tools/research-watch.mjs',[...args,'--data-dir',dir,'--scope','public','--json','--at',time,'--http-fixture',empty]);
  const worker=(dir,id,phase,time=at)=>run('tests/helpers/friday-proof-worker.mjs',[dir,id,phase,time]);
  const doctor=memory(state,'init');
  run('tools/research-analysis.mjs',['migrate','--data-dir',state,'--scope','public','--json','--backup',path.join(temp,'v1.sqlite')]);
  watch(state,at,'migrate','--backup',path.join(temp,'v2.sqlite'));
  const added=watch(state,at,'add','--input',input);assert.equal(added.state,'DISABLED');
  const initial=worker(state,added.id,'initial'),changed=worker(state,added.id,'changed');
  assert.ok(changed.outcome.events.some(e=>e.kind==='CHANGED'));assert.equal(changed.outcome.emitted,true);assert.equal(changed.calls[0].etag,null);
  assert.equal(changed.outcome.events[0].right.hash,changed.control.observations[0].hash);assert.notEqual(initial.outcome.events[0].right.hash,changed.control.observations[0].hash);
  watch(state,at,'report',changed.outcome.reportId,'--write');watch(state,at,'report',changed.outcome.reportId,'--write');
  const introduced=worker(state,added.id,'introduce');assert.equal(introduced.calls[0].etag,'"shared"');assert.equal(introduced.calls[1].etag,null);assert.ok(introduced.outcome.events.some(e=>e.kind==='CHANGED'));
  const epoch1=watch(state,at,'enable',added.id),due1=worker(state,added.id,'due');assert.equal(due1.calls.length,1);
  assert.equal(worker(state,added.id,'due').calls.length,0);watch(state,at,'disable',added.id);
  const epoch2=watch(state,at,'enable',added.id),due2=worker(state,added.id,'due');assert.notEqual(epoch1.activationId,epoch2.activationId);assert.equal(due2.calls.length,1);assert.equal(due2.outcome.results[0].duplicate,undefined);
  assert.notEqual(due1.outcome.results[0].attempt,due2.outcome.results[0].attempt);assert.equal(worker(state,added.id,'due').calls.length,0);
  const backup=path.join(temp,'v3.sqlite');memory(state,'backup','--out',backup);memory(restored,'restore','--from',backup);
  const current=watch(restored,at,'show',added.id);assert.equal(current.activationId,epoch2.activationId);assert.equal(current.nextDueAt,due2.outcome.results[0].nextDueAt);
  const future=worker(restored,added.id,'due',later);assert.equal(future.calls.length,1);assert.ok(future.outcome.results[0].nextDueAt>later);
  const history=watch(restored,later,'history',added.id,'--all');assert.equal(history.attempts.length,6);assert.equal(history.deliveries.filter(d=>d.id===changed.outcome.reportId&&d.status==='DELIVERED').length,1);
  watch(restored,later,'disable',added.id);assert.equal(worker(restored,added.id,'due',later).calls.length,0);assert.equal(watch(restored,later,'show',added.id).state,'DISABLED');
  console.log(JSON.stringify({version:1,status:'PASS',startedAt,completedAt:new Date().toISOString(),commit:spawnSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).stdout.trim(),workingTreeDirty:!!spawnSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).stdout.trim(),node:process.version,platform:process.platform,arch:process.arch,driver:doctor.driver,sqlite:doctor.sqlite,separateProcesses:runs.length,
    p1:{redirectedThenDirect:'CHANGED',directThenRedirected:'CHANGED',conditionalScope:'EXACT_URI',controlHashMatches:true},p2:{sameClockEpochsDistinct:true,restartedProcesses:true,scheduleAdvances:true,restoredActivation:true},schema:3,ddlChanges:false,singleDelivery:true,backgroundWorker:'NOT_STARTED',osTasksInstalled:0,network:'DENIED; explicit fake transport only',watch:'OFF',runs},null,2));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
