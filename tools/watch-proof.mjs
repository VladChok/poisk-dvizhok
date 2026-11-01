#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const ROOT=fileURLToPath(new URL('../',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'watch-proof-'));
const state=path.join(temp,'state'),restored=path.join(temp,'restored'),rollback=path.join(temp,'rollback'),runs=[],startedAt=new Date().toISOString();
const preload=new URL('../tests/helpers/offline.mjs',import.meta.url).href;
const redact=s=>s.split(temp).join('<temp>');
function run(script,args,expected=0){const r=spawnSync(process.execPath,[script,...args],{cwd:ROOT,encoding:'utf8',timeout:30000,env:{...process.env,NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --import=${preload}`.trim()}});assert.equal(r.status,expected,r.stdout+r.stderr);runs.push({command:redact(`node ${script} ${args.join(' ')}`),exitCode:r.status,stdout:redact(r.stdout),stderr:redact(r.stderr)});return r.stdout;}
const memory=(dir,...a)=>JSON.parse(run('tools/research-memory.mjs',[...a,'--data-dir',dir,'--scope','public','--json']));
const analysis=(dir,...a)=>JSON.parse(run('tools/research-analysis.mjs',[...a,'--data-dir',dir,'--scope','public','--json']));
const write=(name,value)=>{const file=path.join(temp,name);fs.writeFileSync(file,JSON.stringify(value));return file;};
const url='https://feeds.example.com/news',at=n=>new Date(Date.parse('2026-10-31T00:00:00.000Z')+n*1000).toISOString();
const fixture=(name,body,status=200,etag='"v1"')=>write(name,{version:1,responses:[{url,status,responseHeaders:{'content-type':'application/rss+xml',...(etag?{etag}:{})},body}]});
const xml=(items)=>`<rss><channel>${items.map(([id,text])=>`<item><guid>${id}</guid><description>${text}</description></item>`).join('')}</channel></rss>`;
try{
  const empty=write('empty.json',{version:1,responses:[]});
  const watch=(dir,n,file,...a)=>JSON.parse(run('tools/research-watch.mjs',[...a,'--data-dir',dir,'--scope','public','--json','--http-fixture',file,'--at',at(n)]));
  const doctor=memory(state,'init'),imported=memory(state,'import','research/e0-node-sqlite');
  analysis(state,'migrate','--backup',path.join(temp,'v1.sqlite'));
  const linkFile=write('link.json',{left:{kind:'claim',id:imported.bundle,claim:'c1'},right:{kind:'claim',id:imported.bundle,claim:'c2'},brief:imported.brief,relation:'NOT_COMPARABLE',subject:{id:'node-doc',label:'Node',context:'Different documented properties'},actor:'fixture',rationale:'Retain existing E3 ledger.'});
  const link=analysis(state,'link','--input',linkFile);
  const review=write('review.json',{link:link.id,decision:'WITHDRAWN',actor:'fixture',rationale:'Fixture withdrawal preserved.',key:'e4-proof'});analysis(state,'review','--input',review);
  const v2=path.join(temp,'v2.sqlite');watch(state,0,empty,'migrate','--backup',v2);
  const definition=write('definition.json',{name:'fixture-feed',source:'rss',url,interval:'1h',timezone:'America/New_York',brief:imported.brief,out:path.join(temp,'reports'),config:{allowedHosts:['feeds.example.com'],feeds:[url],limits:{minIntervalMs:0,retries:0}}});
  const added=watch(state,0,empty,'add','--input',definition);assert.equal(added.state,'DISABLED');assert.equal(watch(state,0,empty,'list').watches[0].state,'DISABLED');
  const a=fixture('a.json',xml([['one','first']]),200,'"a"'),b=fixture('b.json',xml([['one','changed'],['two','new']]),200,'"b"'),conditional=fixture('304.json','',304,null);
  const first=watch(state,1,a,'run',added.id,'--once','--key','first');assert.ok(first.events.some(e=>e.kind==='NEW'));
  assert.equal(watch(state,1,empty,'run',added.id,'--once','--key','first').duplicate,true);
  assert.equal(watch(state,2,a,'run',added.id,'--once').emitted,false);
  const changed=watch(state,3,b,'run',added.id,'--once');assert.ok(changed.events.some(e=>e.kind==='CHANGED'));assert.ok(changed.events.some(e=>e.kind==='NEW'));
  const cached=watch(state,4,conditional,'run',added.id,'--once');assert.equal(cached.emitted,false);assert.ok(cached.events.every(e=>e.kind==='NOT_MODIFIED'));
  assert.equal(watch(state,4,empty,'report',changed.reportId).delivery,'PENDING');
  watch(state,4,empty,'report',changed.reportId,'--write');watch(state,4,empty,'report',changed.reportId,'--write');
  const report=JSON.parse(fs.readFileSync(path.join(temp,'reports',changed.reportId,'report.json'),'utf8'));assert.equal(report.deltas.length,2);
  assert.match(fs.readFileSync(path.join(temp,'reports',changed.reportId,'REPORT.md'),'utf8'),/CHANGED/);
  watch(state,5,empty,'enable',added.id);const due=watch(state,5,b,'due','--once');assert.equal(due.results.length,1);assert.equal(due.results[0].emitted,false);
  watch(state,6,empty,'disable',added.id);assert.equal(watch(state,7200,empty,'due','--once').results.length,0);
  assert.equal(watch(state,7200,empty,'history',added.id,'--all').attempts.length,5);
  const v3=path.join(temp,'v3.sqlite');memory(state,'backup','--out',v3);memory(restored,'restore','--from',v3);
  assert.equal(watch(restored,7200,empty,'show',added.id).state,'DISABLED');assert.equal(watch(restored,7200,empty,'report',changed.reportId).delivery,'DELIVERED');
  assert.equal(analysis(restored,'link','--id',link.id).reviews[0].decision,'WITHDRAWN');
  memory(rollback,'restore','--from',v2);assert.equal(memory(rollback,'doctor').schema,2);assert.equal(analysis(rollback,'link','--id',link.id).reviews.length,1);
  const out=path.join(temp,imported.brief);memory(restored,'export',imported.brief,'--out',out);
  run('tools/research-map.mjs',['validate',path.join(out,'map.json')]);run('tools/research-map.mjs',['validate-evidence',path.join(out,'evidence.jsonl'),'--map',path.join(out,'map.json')]);run('tools/research-bundle.mjs',['inspect',out,'--json']);
  const hashes={};for(const name of ['brief.md','map.json','evidence.jsonl','sources.json','sources/sqlite-api.md','sources/sqlite-module.txt','sources/NODE-LICENSE.txt']){const bytes=fs.readFileSync(path.join(out,name));assert.deepEqual(bytes,fs.readFileSync(path.join(ROOT,'research/e0-node-sqlite',name)));hashes[name]=createHash('sha256').update(bytes).digest('hex');}
  watch(state,7201,empty,'remove',added.id);assert.equal(watch(state,7201,empty,'show',added.id).state,'REMOVED');
  console.log(JSON.stringify({version:1,status:'PASS',startedAt,completedAt:new Date().toISOString(),
    commit:spawnSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).stdout.trim(),workingTreeDirty:!!spawnSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).stdout.trim(),
    node:process.version,platform:process.platform,arch:process.arch,driver:doctor.driver,sqlite:doctor.sqlite,separateProcesses:runs.length,migratedFrom:2,migratedTo:3,v2Rollback:true,v3Restored:true,
    retainedE3Review:'WITHDRAWN',deduplicatedReports:true,disabledDueRequests:0,exactV0Hashes:hashes,backgroundWorker:'NOT_STARTED',osTasksInstalled:0,network:'DENIED; explicit E1 HTTP JSON fixtures only',watch:'OFF',runs},null,2));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
