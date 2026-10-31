import {randomUUID} from 'node:crypto';
import {openMemory} from '../memory/store.mjs';
import {ResearchAnalysis} from '../analysis/store.mjs';
import {resolve} from '../analysis/records.mjs';
import {encode,identity,string} from '../analysis/records.mjs';
import {fail,code,MemoryError} from '../memory/safety.mjs';
import {createHarness} from '../harness/engine.mjs';
import {definition,retryDelay} from './config.mjs';
import {publish} from './report.mjs';
const ref=id=>({kind:'check',id});
const page=(limit,offset)=>{if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>100000)fail('INVALID_QUERY');};
const plus=(at,ms)=>new Date(Date.parse(at)+ms).toISOString();
export class ResearchWatch {
  constructor(memory,deps={}) {
    if(memory.doctor().schema!==3)fail('WATCH_MIGRATION_REQUIRED');
    this.memory=memory;this.db=memory.db;this.analysis=new ResearchAnalysis(memory);this.deps=deps;
  }
  close(){this.memory.close();}
  event(watch,action,payload={},at=this.memory.now()){
    const id=identity([watch,action,at,randomUUID()]);this.db.prepare('INSERT INTO watch_events VALUES (?,?,?,?,?)').run(id,watch,at,action,encode(payload));return id;
  }
  get(id){
    const row=this.db.prepare('SELECT d.*,s.* FROM watch_definitions d JOIN watch_state s ON s.watch_id=d.id WHERE d.id=? OR d.name=?').get(id,id);
    if(!row)fail('WATCH_NOT_FOUND');
    const activation=this.db.prepare("SELECT id FROM watch_events WHERE watch_id=? AND action='ENABLE' ORDER BY rowid DESC LIMIT 1").get(row.id);
    return {...row,activationId:activation?.id||null,definition:JSON.parse(row.definition_json),validators:JSON.parse(row.validators_json)};
  }
  show(id){const w=this.get(id);return {id:w.id,name:w.name,definition:w.definition,configHash:w.config_hash,state:w.status,activationId:w.activationId,nextDueAt:w.next_due_at,lastGoodRun:w.last_good_run,activeLease:!!w.lease_token,backgroundWorker:'NOT_STARTED',watch:'OFF'};}
  list({limit=50,offset=0}={}){page(limit,offset);return {watches:this.db.prepare('SELECT id FROM watch_definitions ORDER BY name LIMIT ? OFFSET ?').all(limit,offset).map(r=>this.show(r.id)),backgroundWorker:'NOT_STARTED'};}
  add(input){
    const d=definition(input,this.memory);this.analysis.brief(d.brief);const fingerprint=identity(d),at=this.memory.now();
    return this.memory.transaction(()=>{
      const old=this.db.prepare('SELECT config_hash FROM watch_definitions WHERE id=?').get(d.id);
      if(old){if(old.config_hash!==fingerprint)fail('IDEMPOTENCY_CONFLICT');return {...this.show(d.id),duplicate:true};}
      this.db.prepare('INSERT INTO watch_definitions VALUES (?,?,?,?,?,?)').run(d.id,d.name,at,encode(d),fingerprint,d.brief);
      this.db.prepare('INSERT INTO watch_state(watch_id,status,last_clock_at,updated_at) VALUES (?,?,?,?)').run(d.id,'DISABLED',at,at);
      this.event(d.id,'ADD',{actor:d.actor,configHash:fingerprint},at);return this.show(d.id);
    });
  }
  control(id,action,{actor='local-operator',reason='Explicit local operator command'}={}){
    string(actor,128);string(reason);if(!['ENABLE','DISABLE','REMOVE'].includes(action))fail('INVALID_WATCH_ACTION');
    return this.memory.transaction(()=>{
      const w=this.get(id),at=this.memory.now();if(Date.parse(at)<Date.parse(w.last_clock_at))fail('CLOCK_SKEW');
      if(w.status==='REMOVED')fail('WATCH_REMOVED');
      if(action==='ENABLE'&&w.status==='ENABLED'){
        this.db.prepare('UPDATE watch_state SET last_clock_at=?,updated_at=? WHERE watch_id=?').run(at,at,w.id);
        this.event(w.id,'ENABLE_NOOP',{actor,reason,activationId:w.activationId},at);return this.show(w.id);
      }
      if(action!=='ENABLE'&&w.active_attempt)this.db.prepare("UPDATE watch_attempts SET status='CANCELLED',finished_at=? WHERE id=? AND status='RUNNING'").run(at,w.active_attempt);
      this.db.prepare('UPDATE watch_state SET status=?,next_due_at=?,last_clock_at=?,updated_at=? WHERE watch_id=?').run(action==='ENABLE'?'ENABLED':action==='REMOVE'?'REMOVED':'DISABLED',action==='ENABLE'?at:null,at,at,w.id);
      if(action!=='ENABLE')this.db.prepare('UPDATE watch_state SET lease_token=NULL,lease_until=NULL,active_attempt=NULL WHERE watch_id=?').run(w.id);
      this.event(w.id,action,{actor,reason},at);return this.show(w.id);
    });
  }
  claim(id,{scheduled=false,expectedDue,expectedActivation,key}={}){
    if(key!==undefined)string(key,200);
    return this.memory.transaction(()=>{
      const w=this.get(id),at=this.memory.now();if(w.status==='REMOVED')fail('WATCH_REMOVED');
      // Scheduled eligibility and activation fencing precede completed-key
      // lookup. The durable ENABLE event is the epoch, including equal clocks.
      if(scheduled){
        if(w.status!=='ENABLED'||!w.activationId||!w.next_due_at||w.next_due_at>at||
          (expectedDue&&expectedDue!==w.next_due_at)||(expectedActivation&&expectedActivation!==w.activationId))return {skipped:'NOT_DUE'};
        const scheduledKey=`due-v2:${identity([w.id,w.activationId,w.next_due_at])}`;
        if(key!==undefined&&key!==scheduledKey)fail('INVALID_SCHEDULE_KEY');key=scheduledKey;
      }
      if(key){const prior=this.db.prepare("SELECT result_json FROM watch_attempts WHERE watch_id=? AND request_key=? AND status='COMPLETED' ORDER BY rowid DESC LIMIT 1").get(w.id,key);if(prior)return {duplicate:JSON.parse(prior.result_json)};}
      if(Date.parse(at)<Date.parse(w.last_clock_at)){this.event(w.id,'CLOCK_SKEW',{},at);return {skipped:'CLOCK_SKEW'};}
      if(w.lease_token&&w.lease_until>at)fail('WATCH_BUSY');
      const origins=w.definition.config.allowedHosts.map(h=>`https://${h}`);
      const cooldown=origins.length?this.db.prepare(`SELECT retry_at FROM watch_cooldowns WHERE origin IN (${origins.map(()=>'?').join(',')}) AND retry_at>? ORDER BY retry_at DESC LIMIT 1`).get(...origins,at):null;
      if(cooldown){if(w.status==='ENABLED')this.db.prepare('UPDATE watch_state SET next_due_at=? WHERE watch_id=?').run(cooldown.retry_at,w.id);this.event(w.id,'RATE_LIMIT_DEFER',{retryAt:cooldown.retry_at},at);return {skipped:'RETRY_NOT_DUE',retryAt:cooldown.retry_at};}
      if(this.db.prepare("SELECT count(*) n FROM watch_deliveries WHERE watch_id=? AND status='PENDING'").get(w.id).n>=w.definition.maxPending)fail('QUOTA');
      if(w.active_attempt){this.db.prepare("UPDATE watch_attempts SET status='ABANDONED',finished_at=? WHERE id=? AND status='RUNNING'").run(at,w.active_attempt);this.event(w.id,'RECOVER_EXPIRED_LEASE',{attempt:w.active_attempt},at);}
      const token=randomUUID(),attempt=identity([w.id,token]),l=w.definition.config.limits;
      const leaseMs=Math.max(60000,l.maxRequests*(l.timeoutMs+l.maxWaitMs+l.minIntervalMs)+30000);
      this.db.prepare('INSERT INTO watch_attempts VALUES (?,?,?,?,?,?,?,?,?)').run(attempt,w.id,key||null,at,null,'RUNNING',token,null,null);
      this.db.prepare('UPDATE watch_state SET lease_token=?,lease_until=?,active_attempt=?,last_clock_at=?,updated_at=? WHERE watch_id=?').run(token,plus(at,leaseMs),attempt,at,at,w.id);
      this.event(w.id,'CHECK_START',{attempt,scheduled,leaseMs,activationId:scheduled?w.activationId:null,dueAt:scheduled?w.next_due_at:null},at);return {watch:w,at,attempt,token,scheduled,activationId:w.activationId,dueAt:w.next_due_at};
    });
  }
  fenced(c){const w=this.get(c.watch.id);if(w.lease_token!==c.token||w.active_attempt!==c.attempt||w.status==='REMOVED'||(c.scheduled&&(w.status!=='ENABLED'||w.activationId!==c.activationId)))fail('LEASE_LOST');return w;}
  finish(c,result,sent){
    return this.memory.transaction(()=>{
      const w=this.fenced(c),at=this.memory.now(),d=w.definition;
      const floor=w.last_clock_at>c.at?w.last_clock_at:c.at;
      const clockOK=Date.parse(at)>=Date.parse(floor), effectiveAt=clockOK?at:floor;
      const stored=this.memory.storeRun(result,{brief:d.brief,key:c.attempt,at:effectiveAt});
      for(const cooldown of result.cooldowns||[])this.db.prepare('INSERT INTO watch_cooldowns VALUES (?,?) ON CONFLICT(origin) DO UPDATE SET retry_at=MAX(retry_at,excluded.retry_at)').run(cooldown.origin,cooldown.retryAt);
      const rows=this.db.prepare('SELECT id FROM checks WHERE run_id=? ORDER BY id').all(stored.run);
      for(const row of rows)this.db.prepare('INSERT OR IGNORE INTO watch_members VALUES (?,?)').run(c.attempt,row.id);
      const coverage=this.analysis.coverage({brief:d.brief,family:`watch:${w.id}`,question:`Captured checks of ${d.name}`,runIds:[stored.run]}, {save:true});
      const oldRows=this.db.prepare('SELECT * FROM watch_baselines WHERE watch_id=? ORDER BY identity').all(w.id);
      const old=new Map(oldRows.map(r=>[r.identity,resolve(this.db,ref(r.check_id)).items[0]]));
      const current=resolve(this.db,{kind:'run',id:stored.run});
      const conditionalRow=this.db.prepare("SELECT * FROM checks WHERE run_id=? AND status='NOT_MODIFIED' ORDER BY id LIMIT 1").get(stored.run);
      const conditional=conditionalRow?JSON.parse(conditionalRow.observation_json):null;
      const representation=result.representation,condition=representation?.conditional;
      const valid304=result.status==='NOT_MODIFIED'&&!!w.last_good_run&&!!conditionalRow&&conditionalRow.baseline_status==='REUSED_LAST_GOOD'&&
        !!w.validators.uri&&representation?.effectiveUrl===w.validators.uri&&condition?.uri===w.validators.uri&&
        (sent.etag?condition.etag===sent.etag:!!sent.lastModified&&condition.lastModified===sent.lastModified)&&
        !!(sent.etag||sent.lastModified)&&conditionalRow.revision_id===w.validators.revisionId&&
        (sent.etag?conditional.etag===sent.etag:conditional.lastModified===sent.lastModified)&&clockOK;
      const is304=result.status==='NOT_MODIFIED';
      const counters=result.coverage;
      const complete=result.status==='OK'&&counters?.complete===true&&!counters.invalidItems&&!counters.duplicateItems&&!counters.filteredItems;
      const usable=['OK','PARTIAL'].includes(result.status)&&clockOK&&!counters?.duplicateItems;
      let snapshots=is304?(valid304?JSON.parse(w.membership_json).map(member=>resolve(this.db,ref(member.checkId)).items[0]):[]):current.items;
      let badCapture=!clockOK;
      const counts=new Map();for(const s of snapshots)counts.set(s.contentIdentity,(counts.get(s.contentIdentity)||0)+1);
      const seen=new Set(),events=[];
      for(const item of snapshots){
        const key=item.contentIdentity,previous=old.get(key);seen.add(key);
        const sourceDateOK=!(item.observation?.limitations||[]).some(l=>/INVALID_SOURCE_DATE/.test(l))&&
          Date.parse(item.retrievedAt)<=Date.parse(effectiveAt)&&(!previous||Date.parse(item.retrievedAt)>=Date.parse(previous.retrievedAt));
        let comparison=null,kind='STILL_UNKNOWN',reason='INSUFFICIENT_RECORDED_CONTENT_OR_COVERAGE';
        if(is304&&valid304){kind=previous&&previous.revisionId!==item.revisionId?'STILL_UNKNOWN':'NOT_MODIFIED';reason=kind==='STILL_UNKNOWN'?'STALE_304_MEMBERSHIP_VS_LATEST_CAPTURE':'VALIDATED_OWN_WATCH_BASELINE; no new bytes';}
        else if(usable&&sourceDateOK&&counts.get(key)===1&&item.availability==='OBSERVED'&&item.hasContent&&item.hash){
          if(!previous){kind='NEW';reason='NEW_CAPTURE_IN_BOUNDED_SCOPE; not independently verified';}
          else{
            comparison=this.analysis.compare(ref(previous.checkId),ref(item.checkId),{brief:d.brief,save:true});
            const p=comparison.pairs[0];kind=p.verdict==='SAME'?(p.changedFields.length?'CHANGED':'SAME'):p.verdict==='CHANGED'?'CHANGED':'STILL_UNKNOWN';reason=p.reason;
          }
        }else if(!sourceDateOK)reason='INVALID_OR_OUT_OF_ORDER_SOURCE_DATE';
        const event={kind,identity:key,reason,left:previous||null,right:item,comparisonId:comparison?.id||null,changedFields:comparison?.pairs[0]?.changedFields||[],validatedBy:valid304?conditionalRow.id:null,absence:'NOT_PROVEN',factualContradiction:false};
        if(kind==='STILL_UNKNOWN')badCapture=true;
        events.push(event);
        if(['NEW','CHANGED','SAME'].includes(kind)&&!is304)this.db.prepare('INSERT INTO watch_baselines VALUES (?,?,?,?) ON CONFLICT(watch_id,identity) DO UPDATE SET check_id=excluded.check_id,last_seen_at=excluded.last_seen_at').run(w.id,key,item.checkId,effectiveAt);
        if(is304&&valid304)this.db.prepare('INSERT OR IGNORE INTO watch_members VALUES (?,?)').run(c.attempt,item.checkId);
      }
      if(!is304||!valid304)for(const [key,previous]of old)if(!seen.has(key))events.push({kind:complete&&d.source==='rss'?'REMOVED_OR_UNAVAILABLE':'STILL_UNKNOWN',identity:key,
        reason:complete&&d.source==='rss'?'NOT_OBSERVED_IN_COMPARABLE_FEED_RESPONSE; not confirmed deletion':'NOT_OBSERVED_IN_BOUNDED_OR_FAILED_RUN',left:previous,right:null,comparisonId:null,absence:'NOT_PROVEN',factualContradiction:false});
      if(!['OK','PARTIAL'].includes(result.status)&&!valid304)events.push({kind:result.status==='NOT_FOUND'?'REMOVED_OR_UNAVAILABLE':'STILL_UNKNOWN',identity:`target:${w.id}`,
        reason:is304?'UNVALIDATED_NOT_MODIFIED_BASELINE':clockOK?`FETCH_${result.status}`:'CLOCK_SKEW',left:w.validators.checkId?resolve(this.db,ref(w.validators.checkId)).items[0]:null,
        right:{pointer:{locator:d.target.url||'https://api.github.com/search/repositories',version:`unavailable run:${stored.run}`},runId:stored.run,availability:'UNAVAILABLE',retrievedAt:effectiveAt},comparisonId:null,absence:'NOT_PROVEN',factualContradiction:false});
      if(!events.length)events.push({kind:valid304?'NOT_MODIFIED':complete?'SAME':'STILL_UNKNOWN',identity:`target:${w.id}`,reason:'NO_CAPTURED_ITEMS; absence NOT_PROVEN',left:null,right:null,comparisonId:null,absence:'NOT_PROVEN',factualContradiction:false});
      if(events.length>201)fail('WATCH_LIMIT');
      const meaningful=events.filter(e=>!['SAME','NOT_MODIFIED'].includes(e.kind));
      const signature=identity(meaningful.map(e=>[e.kind,e.identity,e.reason,e.left?.hash||null,e.right?.hash||null,e.right?.observation?.revision||null]).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:1));
      const emit=meaningful.length>0&&signature!==w.outcome_signature,generation=w.generation+(emit?1:0);
      let reportId=null;
      if(emit){
        for(const e of meaningful){e.id=identity([w.id,generation,e.identity,e.kind]);this.db.prepare('INSERT INTO watch_deltas VALUES (?,?,?,?,?,?,?)').run(e.id,w.id,c.attempt,effectiveAt,e.kind,e.comparisonId,encode(e));}
        reportId=identity([w.id,generation,signature]);
        const payload={version:1,method:'watch-on-e3-recorded-v1',id:reportId,watch:{id:w.id,name:d.name,timezone:d.timezone,configHash:w.config_hash},at:effectiveAt,runId:stored.run,coverageId:coverage.id,acquisitionStatus:result.status,
          request:result.request||{},representation:representation||null,coverage:{counters:result.coverage||null,assessment:coverage.assessment,gaps:coverage.gaps,sourceRefs:coverage.usedRoutes[0]?.sourceRefs||[],providerCooldowns:result.cooldowns||[]},
          deltas:meaningful,limitations:[...coverage.gaps,...current.limitations,'Recorded source representations; no automatic truth or deletion judgement.'],absence:'NOT_PROVEN'};
        this.db.prepare('INSERT INTO watch_deliveries VALUES (?,?,?,?,?,?,?)').run(reportId,w.id,c.attempt,effectiveAt,encode(payload),'PENDING',null);
      }
      let validators=w.validators,lastGood=w.last_good_run,membership=JSON.parse(w.membership_json);
      if(complete&&!badCapture){
        const root=this.db.prepare("SELECT c.* FROM checks c JOIN sources s ON s.id=c.source_id WHERE c.run_id=? AND c.status='OBSERVED' ORDER BY (s.source_type='feed') DESC,c.id LIMIT 1").get(stored.run);
        if(d.source==='rss'&&root){const o=JSON.parse(root.observation_json);validators={etag:o.etag,lastModified:o.lastModified,uri:representation?.effectiveUrl||null,revisionId:root.revision_id,checkId:root.id};lastGood=stored.run;membership=snapshots.map(s=>({identity:s.contentIdentity,checkId:s.checkId}));}
        else if(d.target.mode==='pinned-audit'&&root){const o=JSON.parse(root.observation_json);validators={etag:o.etag,lastModified:o.lastModified,uri:representation?.effectiveUrl||null,revisionId:root.revision_id,checkId:root.id};lastGood=stored.run;}
        else if(d.target.query)lastGood=stored.run;
      }
      if(!complete&&events.some(e=>['NEW','CHANGED'].includes(e.kind)))validators={};
      if(result.status==='UNVALIDATED_NOT_MODIFIED')validators={};
      const healthy=clockOK&&!badCapture&&(complete||valid304),failures=healthy?0:w.failure_count+1;
      const localNext=plus(effectiveAt,healthy?d.intervalMs:retryDelay(w.id,failures,d.intervalMs));
      const providerNext=(result.cooldowns||[]).map(c=>c.retryAt).sort().at(-1);
      const next=providerNext&&providerNext>localNext?providerNext:localNext;
      const outcome={attempt:c.attempt,runId:stored.run,coverageId:coverage.id,status:!clockOK?'CLOCK_SKEW':healthy?'OK':result.status==='OK'?'PARTIAL':result.status,acquisitionStatus:result.status,
        schedule:c.scheduled?{activationId:c.activationId,dueAt:c.dueAt}:null,
        events,emitted:emit,reportId,nextDueAt:w.status==='ENABLED'?next:null,baselineRun:lastGood,watch:'OFF'};
      this.db.prepare("UPDATE watch_attempts SET finished_at=?,status='COMPLETED',run_id=?,result_json=? WHERE id=?").run(effectiveAt,stored.run,encode(outcome),c.attempt);
      this.db.prepare('UPDATE watch_state SET next_due_at=?,last_clock_at=?,failure_count=?,lease_token=NULL,lease_until=NULL,active_attempt=NULL,last_good_run=?,validators_json=?,membership_json=?,generation=?,outcome_signature=?,updated_at=? WHERE watch_id=?').run(w.status==='ENABLED'?next:null,effectiveAt,failures,lastGood,encode(validators),encode(membership),generation,signature,effectiveAt,w.id);
      this.event(w.id,'CHECK_COMPLETE',{attempt:c.attempt,run:stored.run,status:outcome.status,reportId},effectiveAt);return outcome;
    });
  }
  async run(id,{scheduled=false,expectedDue,expectedActivation,key,signal,write=false,allowPrivate=false}={}){
    if(write&&this.memory.scope==='private'&&!allowPrivate)fail('PRIVATE_EXPORT_REQUIRED');
    const c=this.claim(id,{scheduled,expectedDue,expectedActivation,key});if(c.skipped)return {status:c.skipped,skipped:true,...(c.retryAt?{retryAt:c.retryAt}:{}),watch:'OFF'};
    if(c.duplicate){if(write&&c.duplicate.reportId)this.deliver(c.duplicate.reportId,{allowPrivate});return {...c.duplicate,duplicate:true};}
    let outcome;
    try{
      const d=c.watch.definition,v=c.watch.validators;
      // Legacy cursors have no proven URI. Refresh them with an unconditional
      // check; never infer scope from an old root accessRoute (E4 stored target).
      const sent=d.target.query||!v.uri||(d.source==='rss'&&v.uri!==d.target.url)?{}:{etag:v.etag,lastModified:v.lastModified,validatorUrl:v.uri};
      const harness=createHarness(d.config,{...this.deps.harness,clock:()=>Date.parse(this.memory.now())});
      const result=await harness[d.target.operation](d.source,{...d.target,...sent,signal});
      if(signal?.aborted)result.status='CANCELLED';
      outcome=this.finish(c,result,sent);
    }catch(error){
      const status=code(error);
      this.memory.transaction(()=>{
        const w=this.get(c.watch.id);if(w.lease_token!==c.token)return;
        let at;try{at=this.memory.now();}catch{at=c.at;}
        const floor=w.last_clock_at>c.at?w.last_clock_at:c.at;
        const effectiveAt=at<floor?floor:at,next=plus(effectiveAt,retryDelay(w.id,w.failure_count+1,w.definition.intervalMs));
        this.db.prepare("UPDATE watch_attempts SET finished_at=?,status='FAILED',result_json=? WHERE id=?").run(effectiveAt,encode({status,watch:'OFF'}),c.attempt);
        this.db.prepare('UPDATE watch_state SET lease_token=NULL,lease_until=NULL,active_attempt=NULL,next_due_at=?,failure_count=failure_count+1,last_clock_at=?,updated_at=? WHERE watch_id=?').run(w.status==='ENABLED'?next:null,effectiveAt,effectiveAt,w.id);
        this.event(w.id,'CHECK_FAILED',{attempt:c.attempt,status},effectiveAt);
      });throw new MemoryError(status);
    }
    this.deps.afterCommit?.(outcome);
    if(write&&outcome.reportId)this.deliver(outcome.reportId,{allowPrivate});return outcome;
  }
  async due({limit=10,maxRequests=50,signal,write=false,allowPrivate=false}={}){
    if(!Number.isInteger(limit)||limit<1||limit>10||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>50)fail('INVALID_WATCH_BUDGET');
    const at=this.memory.now(),rows=this.db.prepare("SELECT watch_id,next_due_at,(SELECT e.id FROM watch_events e WHERE e.watch_id=s.watch_id AND e.action='ENABLE' ORDER BY e.rowid DESC LIMIT 1) activation_id FROM watch_state s WHERE status='ENABLED' AND next_due_at<=? ORDER BY next_due_at,watch_id LIMIT ?").all(at,limit);
    const results=[];let reserved=0;
    for(const row of rows){if(signal?.aborted)break;const w=this.get(row.watch_id),budget=w.definition.config.limits.maxRequests;
      if(reserved+budget>maxRequests){results.push({id:w.id,skipped:'REQUEST_BUDGET'});continue;}reserved+=budget;
      try{results.push(await this.run(w.id,{scheduled:true,expectedDue:row.next_due_at,expectedActivation:row.activation_id,signal,write,allowPrivate}));}
      catch(error){results.push({id:w.id,status:code(error)});}
    }
    return {results,reservedRequests:reserved,concurrency:1,backgroundWorker:'NOT_STARTED',watch:'OFF'};
  }
  history(id,{limit=50,offset=0,all=false}={}){
    page(limit,offset);const w=this.get(id),from=all?'0000':plus(this.memory.now(),-w.definition.historyDays*86400000);
    const attempts=this.db.prepare('SELECT * FROM watch_attempts WHERE watch_id=? AND started_at>=? ORDER BY started_at,rowid LIMIT ? OFFSET ?').all(w.id,from,limit,offset).map(({lease_token,result_json,...r})=>({...r,result:result_json?JSON.parse(result_json):null}));
    const events=this.db.prepare('SELECT * FROM watch_events WHERE watch_id=? AND at>=? ORDER BY at,rowid LIMIT ? OFFSET ?').all(w.id,from,limit,offset);
    const deliveries=this.db.prepare('SELECT id,status,created_at,delivered_at FROM watch_deliveries WHERE watch_id=? ORDER BY created_at,rowid LIMIT ? OFFSET ?').all(w.id,limit,offset);
    const result={id:w.id,state:w.status,attempts,events,deliveries,historyFrom:from,retention:'view only; no evidence deleted',watch:'OFF'};encode(result);return result;
  }
  report(id){const row=this.db.prepare('SELECT * FROM watch_deliveries WHERE id=?').get(id);if(!row)fail('REPORT_NOT_FOUND');return {report:JSON.parse(row.payload_json),delivery:row.status};}
  deliver(id,{allowPrivate=false}={}){
    if(this.memory.scope==='private'&&!allowPrivate)fail('PRIVATE_EXPORT_REQUIRED');
    const {report}=this.report(id),w=this.get(report.watch.id);
    if(this.memory.now()<w.last_clock_at||this.memory.now()<report.at)fail('CLOCK_SKEW');
    const result=publish(report,w.definition.outputRoot,{afterFiles:this.deps.beforeReceipt});
    return this.memory.transaction(()=>{
      const at=this.memory.now(),receipt=identity([id,'DELIVERED']);
      if(at<report.at||at<w.last_clock_at)fail('CLOCK_SKEW');
      this.db.prepare('INSERT OR IGNORE INTO watch_receipts VALUES (?,?,?,?,?)').run(receipt,id,at,'DELIVERED',encode(result));
      this.db.prepare("UPDATE watch_deliveries SET status='DELIVERED',delivered_at=COALESCE(delivered_at,?) WHERE id=?").run(at,id);return {...result,delivery:'DELIVERED'};
    });
  }
}
export function openWatch(options={},deps={}){
  const memory=openMemory({...options,supportedVersion:3});try{return new ResearchWatch(memory,deps);}catch(e){memory.close();throw e;}
}
