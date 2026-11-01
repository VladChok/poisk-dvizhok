#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {identity} from '../analysis/records.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'origin-proof-')),state=path.join(temp,'state'),restored=path.join(temp,'restored'),runs=[];
const preload=new URL('../tests/helpers/offline.mjs',import.meta.url).href,at='2026-11-01T00:00:00.000Z',one='2026-11-01T01:00:00.000Z',two='2026-11-01T02:00:00.000Z',redact=s=>s.split(temp).join('<temp>');
function run(script,args){const r=spawnSync(process.execPath,[script,...args],{cwd:ROOT,encoding:'utf8',timeout:30000,env:{...process.env,NODE_OPTIONS:`${process.env.NODE_OPTIONS||''} --import=${preload}`.trim()}});assert.equal(r.status,0,r.stdout+r.stderr);runs.push({command:redact(`node ${script} ${args.join(' ')}`),exitCode:r.status,stdout:redact(r.stdout),stderr:redact(r.stderr)});return JSON.parse(r.stdout);}
const write=(name,obj)=>{const f=path.join(temp,name);fs.writeFileSync(f,JSON.stringify(obj));return f;};
try{
 const empty=write('empty.json',{version:1,responses:[]}),url='https://feeds.example.com/feed';
 const feed=(name,text)=>write(name,{version:1,responses:[{url,status:200,responseHeaders:{'content-type':'application/rss+xml',etag:`"${text}"`},body:`<rss><channel><item><guid>one</guid><description>${text}</description></item></channel></rss>`}]});
 const a=feed('a.json','a'),b=feed('b.json','b'),c=feed('c.json','c'),d=feed('d.json','d');
 const memory=(dir,...args)=>run('tools/research-memory.mjs',[...args,'--data-dir',dir,'--scope','public','--json']);
 const watch=(dir,time,fixture,...args)=>run('tools/research-watch.mjs',[...args,'--data-dir',dir,'--scope','public','--json','--at',time,'--http-fixture',fixture]);
 memory(state,'init');run('tools/research-analysis.mjs',['migrate','--data-dir',state,'--scope','public','--json','--backup',path.join(temp,'v1.sqlite')]);watch(state,at,empty,'migrate','--backup',path.join(temp,'v2.sqlite'));
 const input=write('watch.json',{name:'origin',source:'rss',url,interval:'1h',out:path.join(temp,'reports'),config:{allowedHosts:['feeds.example.com'],feeds:[url],limits:{minIntervalMs:0,retries:0}}});
 const added=watch(state,at,empty,'add','--input',input),enabled=watch(state,at,empty,'enable',added.id),key1=`due-v2:${identity([added.id,enabled.activationId,one])}`,key2=`due-v2:${identity([added.id,enabled.activationId,two])}`;
 const manual1=watch(state,at,a,'run',added.id,'--once','--key',key1,'--write');assert.equal(manual1.schedule,null);
 const due1=watch(state,one,b,'due','--once').results[0];assert.equal(due1.duplicate,undefined);assert.notEqual(due1.attempt,manual1.attempt);assert.ok(due1.nextDueAt>one);
 assert.equal(watch(state,one,empty,'due','--once').results.length,0);
 assert.equal(watch(state,one,empty,'run',added.id,'--once','--key',key1,'--write').attempt,manual1.attempt);
 const due2=watch(state,two,c,'due','--once').results[0];assert.equal(due2.schedule.dueAt,two);
 const manual2=watch(state,two,d,'run',added.id,'--once','--key',key2,'--write');assert.equal(manual2.duplicate,undefined);assert.equal(manual2.schedule,null);assert.notEqual(manual2.attempt,due2.attempt);
 assert.equal(watch(state,two,empty,'run',added.id,'--once','--key',key2,'--write').attempt,manual2.attempt);
 const backup=path.join(temp,'v3.sqlite');memory(state,'backup','--out',backup);memory(restored,'restore','--from',backup);
 assert.equal(watch(restored,two,empty,'run',added.id,'--once','--key',key1,'--write').attempt,manual1.attempt);
 const history=watch(restored,two,empty,'history',added.id,'--all');assert.equal(history.attempts.length,4);assert.equal(new Set(history.attempts.map(r=>r.run_id)).size,4);
 watch(restored,two,empty,'disable',added.id);assert.equal(watch(restored,two,empty,'due','--once').results.length,0);
 console.log(JSON.stringify({status:'PASS',commit:spawnSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).stdout.trim(),workingTreeDirty:!!spawnSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).stdout.trim(),node:process.version,platform:process.platform,separateProcesses:runs.length,schema:3,manualToDue:'ISOLATED',dueToManual:'ISOLATED',manualReplay:'PRESERVED',acquisitions:4,restored:true,backgroundWorker:'NOT_STARTED',osTasksInstalled:0,watch:'OFF',network:'DENIED; fake fixture transport only',runs},null,2));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
