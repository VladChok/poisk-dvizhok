import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createHarness} from '../harness/engine.mjs';
import {createClient} from '../harness/network.mjs';
import {setup,spec,response,xml,A,B} from './helpers/friday-store.mjs';

test('P1 shared transport drops both validators on every changed URI/status and all later redirect hops',async()=>{
  for(const status of [301,302,307,308])for(const target of [B,A+'?page=2','https://cdn.example.com/other']){
    const calls=[],client=createClient({hosts:['feeds.example.com','cdn.example.com'],budget:{minIntervalMs:0,retries:0},lookup:async()=>[{address:'8.8.8.8',family:4}],
      wire:async(url,o)=>{calls.push({url:url.href,...o});return calls.length===1?response('',status,{location:target}):calls.length===2?response('',302,{location:'https://feeds.example.com/final'}):response('fresh');}});
    const r=await client.get(A,{etag:'"A"',lastModified:'Wed, 21 Oct 2026 12:00:00 GMT'});
    assert.equal(r.status,200);assert.equal(calls[0].headers['if-none-match'],'"A"');
    for(const c of calls.slice(1)){assert.equal(c.headers['if-none-match'],undefined);assert.equal(c.headers['if-modified-since'],undefined);assert.equal(c.addresses[0].address,'8.8.8.8');}
    assert.equal(r.representation.effectiveUrl,'https://feeds.example.com/final');assert.equal(r.representation.conditional.etag,null);
  }
});

test('P1 RSS acquisition does not forward A validators when A starts redirecting to changed B',async()=>{
  for(const status of [301,302,307,308]){
    const calls=[],config=spec().config,h=createHarness(config,{token:'',lookup:async()=>[{address:'8.8.8.8',family:4}],wire:async(url,o)=>{
      calls.push({url:url.href,...o});if(url.href===A)return response('',status,{location:B});return o.headers['if-none-match']?response('',304):response(xml('changed B'));
    }});
    const r=await h.retrieve('rss',{url:A,etag:'"v1"'});assert.equal(r.status,'OK');assert.equal(r.observations[0].content,'changed B');assert.equal(calls[1].headers['if-none-match'],undefined);
  }
});

test('P1 WATCH follows newly introduced multi-hop redirects without losing changed bytes or root URI provenance',async t=>{
  const c=await setup(t),w=c.w.add(spec());c.queue.push(response());const first=await c.w.run(w.id);
  c.queue.push(response('',301,{location:B}),response('',307,{location:'https://cdn.example.com/final'}),response(xml('changed')));
  const changed=await c.w.run(w.id);assert.ok(changed.events.some(e=>e.kind==='CHANGED'));assert.equal(changed.emitted,true);
  assert.ok(c.calls.slice(2).every(call=>!call.headers['if-none-match']));
  const cursor=c.w.get(w.id).validators;assert.equal(cursor.uri,'https://cdn.example.com/final');
  assert.equal(JSON.parse(c.w.db.prepare('SELECT observation_json FROM checks WHERE id=?').get(cursor.checkId).observation_json).accessRoute,cursor.uri);
  assert.notEqual(changed.baselineRun,first.runId);
});

test('P1 redirected empty feed stores final URI and never attaches that validator to the original target',async t=>{
  const c=await setup(t),w=c.w.add(spec());c.queue.push(response('',302,{location:B}),response('<rss><channel/></rss>',200,{etag:'"B"'}));
  await c.w.run(w.id);assert.equal(c.w.get(w.id).validators.uri,B);
  c.queue.push(response(xml('now served by A'),200,{etag:'"B"'}));const current=await c.w.run(w.id);
  assert.equal(c.calls.at(-1).headers['if-none-match'],undefined);assert.ok(current.events.some(e=>e.kind==='NEW'));assert.equal(c.w.get(w.id).validators.uri,A);
});

test('P1 direct matching ETag/Last-Modified 304 without response validators remains validated and durable',async t=>{
  const c=await setup(t),w=c.w.add(spec());const date='Wed, 21 Oct 2026 12:00:00 GMT';
  c.queue.push(response(xml(),200,{'last-modified':date}));const first=await c.w.run(w.id);c.w.close();const reopened=c.open();
  c.queue.push(response('',304,{}));const unchanged=await reopened.run(w.id);
  assert.equal(c.calls.at(-1).headers['if-modified-since'],date);assert.ok(unchanged.events.every(e=>e.kind==='NOT_MODIFIED'));assert.equal(unchanged.baselineRun,first.runId);assert.equal(unchanged.emitted,false);
});

test('P1 mismatched/missing/unsolicited redirect 304 is unknown, retains bytes, and refreshes unconditionally',async t=>{
  const c=await setup(t),w=c.w.add(spec());c.queue.push(response());const first=await c.w.run(w.id);
  c.queue.push(response('',304,{etag:'"different"'}));const mismatch=await c.w.run(w.id);
  assert.equal(mismatch.acquisitionStatus,'UNVALIDATED_NOT_MODIFIED');assert.equal(mismatch.baselineRun,first.runId);assert.deepEqual(c.w.get(w.id).validators,{});
  c.queue.push(response('',302,{location:B}),response('',304,{}));const unsolicited=await c.w.run(w.id);
  assert.equal(unsolicited.acquisitionStatus,'UNVALIDATED_NOT_MODIFIED');assert.ok(unsolicited.events.every(e=>e.kind==='STILL_UNKNOWN'));assert.equal(unsolicited.baselineRun,first.runId);
  c.queue.push(response(xml('recovered')));assert.ok((await c.w.run(w.id)).events.some(e=>e.kind==='CHANGED'));assert.equal(c.calls.at(-1).headers['if-none-match'],undefined);
  const date='Wed, 21 Oct 2026 12:00:00 GMT',dated=c.w.add(spec({name:'last-modified'}));
  c.queue.push(response(xml(),200,{'last-modified':date}));const goodDate=await c.w.run(dated.id);
  c.queue.push(response('',304,{'last-modified':'Thu, 22 Oct 2026 12:00:00 GMT'}));const wrongDate=await c.w.run(dated.id);
  assert.equal(wrongDate.acquisitionStatus,'UNVALIDATED_NOT_MODIFIED');assert.equal(wrongDate.baselineRun,goodDate.runId);assert.deepEqual(c.w.get(dated.id).validators,{});
  for(const [headers,options,expected]of [[{}, {etag:'"v1"'},'NOT_MODIFIED'],[{etag:'"wrong"'},{etag:'"v1"'},'UNVALIDATED_NOT_MODIFIED'],[{}, {},'UNVALIDATED_NOT_MODIFIED']]){
    c.queue.push(response('',304,headers));const standalone=await createHarness(spec().config,c.harness).retrieve('rss',{url:A,...options});assert.equal(standalone.status,expected);
  }
});

test('P1 legacy schema-v3 validator JSON is not reinterpreted as scoped and is upgraded only by explicit 200',async t=>{
  const c=await setup(t),w=c.w.add(spec());c.queue.push(response());await c.w.run(w.id);
  const legacy=c.w.get(w.id).validators;delete legacy.uri;c.w.db.prepare('UPDATE watch_state SET validators_json=? WHERE watch_id=?').run(JSON.stringify(legacy),w.id);
  const before=c.w.db.prepare('SELECT validators_json FROM watch_state WHERE watch_id=?').get(w.id).validators_json;
  c.w.close();const reopened=c.open();assert.equal(reopened.memory.doctor().schema,3);reopened.show(w.id);
  assert.equal(reopened.db.prepare('SELECT validators_json FROM watch_state WHERE watch_id=?').get(w.id).validators_json,before);
  c.queue.push(response());await reopened.run(w.id);assert.equal(c.calls.at(-1).headers['if-none-match'],undefined);assert.equal(reopened.get(w.id).validators.uri,A);
});

test('P1 pinned GitHub file audit preserves exact API URI and validates direct 304',async t=>{
  const c=await setup(t),sha='a'.repeat(40),w=c.w.add(spec({source:'github',url:undefined,repo:'owner/repo',ref:sha,file:'doc.md',mode:'pinned-audit'}));
  const content='pinned content',bytes=Buffer.from(content),blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const json=(value,status=200,headers={})=>({status,headers:{'content-type':'application/json',...headers},body:JSON.stringify(value)});
  c.queue.push(json({private:false}),json({type:'file',encoding:'base64',sha:blob,size:bytes.length,content:bytes.toString('base64')},200,{etag:'"file"'}));
  await c.w.run(w.id);assert.equal(c.w.get(w.id).validators.uri,`https://api.github.com/repos/owner/repo/contents/doc.md?ref=${sha}`);
  c.queue.push(json({private:false}),response('',304,{}));const cached=await c.w.run(w.id);assert.ok(cached.events.every(e=>e.kind==='NOT_MODIFIED'));
  assert.equal(c.calls.at(-1).headers['if-none-match'],'"file"');assert.ok(c.calls.every(call=>!call.headers.authorization));
});

test('P1 scoped metadata rejects fabricated redirected conditions and credentials before writing any run',async t=>{
  const c=await setup(t),h=createHarness(spec().config,c.harness);c.queue.push(response());const r=await h.retrieve('rss',{url:A});
  r.representation={...r.representation,effectiveUrl:B,redirected:true,conditional:{uri:B,etag:'"wrong-resource"',lastModified:null}};
  assert.throws(()=>c.w.memory.storeRun(r),/INVALID_REPRESENTATION/);assert.equal(c.w.db.prepare('SELECT count(*) n FROM runs').get().n,0);
});
