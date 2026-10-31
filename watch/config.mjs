import path from 'node:path';
import {fields, string, identity} from '../analysis/records.mjs';
import {safePath, fail} from '../memory/safety.mjs';
import {validateConfig} from '../harness/engine.mjs';
import {safeURL} from '../harness/network.mjs';
export function interval(value) {
  const m=typeof value==='string'&&value.match(/^(\d{1,6})([smhd])$/);
  const ms=m?Number(m[1])*({s:1000,m:60000,h:3600000,d:86400000}[m[2]]):NaN;
  if(!Number.isSafeInteger(ms)||ms<60000||ms>31536000000)fail('INVALID_INTERVAL');return ms;
}
export function definition(input,memory) {
  fields(input,['name','source','url','query','repo','ref','file','mode','config','interval','timezone','out','brief','actor','maxPending','historyDays'],['name','source','interval']);
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(input.name))fail('INVALID_WATCH_NAME');
  const config=validateConfig(input.config||{}), source=input.source;
  if(source==='web')fail('NO_PROVIDER_NO_CREDENTIALS');
  if(!['github','rss'].includes(source))fail('INVALID_WATCH_SOURCE');
  const target={source,operation:source==='rss'?'retrieve':'discover'};
  if(source==='rss') {
    if(input.query||input.repo||input.ref||input.file||input.mode)fail('INVALID_WATCH_TARGET');
    target.url=safeURL(input.url,config.allowedHosts).href;
    if(!config.feeds.includes(target.url)||!config.adapters.rss)fail('FEED_NOT_CONFIGURED');
  }else if(input.query!==undefined){
    if(input.url||input.repo||input.ref||input.file||input.mode)fail('INVALID_WATCH_TARGET');
    if(typeof input.query!=='string'||!input.query.trim()||input.query.length>200||!/^[\p{L}\p{N} _./-]+$/u.test(input.query))fail('INVALID_QUERY');
    target.query=input.query;
  }else{
    if(input.mode!=='pinned-audit'||!/^\w[\w.-]*\/[\w.-]+$/.test(input.repo||'')||input.repo.split('/').some(p=>p==='.'||p==='..')||! /^[a-f0-9]{40}$/.test(input.ref||'')||input.url)fail('PINNED_AUDIT_REQUIRED');
    if(input.file!==undefined&&(typeof input.file!=='string'||!input.file||input.file.length>1000||/[\\\x00-\x1f]/.test(input.file)||input.file.split('/').some(p=>!p||p==='.'||p==='..')))fail('INVALID_FILE');
    Object.assign(target,{operation:'retrieve',mode:'pinned-audit',repo:input.repo,ref:input.ref,...(input.file?{file:input.file}:{})});
  }
  if(source==='github'&&(!config.adapters.github||!config.allowedHosts.includes('api.github.com')))fail('ADAPTER_NOT_ALLOWED');
  const timezone=input.timezone||'UTC';try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format();}catch{fail('INVALID_TIMEZONE');}
  const actor=input.actor||'local-operator';string(actor,128);
  const maxPending=input.maxPending??100, historyDays=input.historyDays??365;
  if(!Number.isInteger(maxPending)||maxPending<1||maxPending>1000||!Number.isInteger(historyDays)||historyDays<1||historyDays>36500)fail('INVALID_WATCH_POLICY');
  const id=identity([memory.scope,input.name]);
  return {id,name:input.name,source,target,config,intervalMs:interval(input.interval),timezone,
    outputRoot:safePath(input.out||path.join(path.dirname(memory.file),'watch-reports',id)),brief:input.brief||null,actor,maxPending,historyDays};
}
export function retryDelay(id,failures,intervalMs) {
  const base=Math.min(86400000,Math.min(intervalMs,300000)*2**Math.min(8,Math.max(0,failures-1)));
  const jitter=parseInt(identity([id,failures]).slice(0,8),16)/0xffffffff;
  return Math.ceil(base*(1+jitter*0.1));
}
