#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openWatch} from '../watch/store.mjs';
import {fixtureTransport} from '../watch/fixtures.mjs';
import {migrateToV3} from '../memory/migrate-v3.mjs';
import {jsonFile,code,fail} from '../memory/safety.mjs';
import {encode} from '../analysis/records.mjs';
const HELP=`Local WATCH E4 — OFF by default, no installed task/service/background process
node tools/research-watch.mjs migrate --backup NEW-v2.sqlite
node tools/research-watch.mjs add --name name --source rss --url DECLARED_FEED --config file --interval 24h [--timezone UTC --out directory --brief id]
node tools/research-watch.mjs add --name name --source github --query "plain terms" --interval 24h
node tools/research-watch.mjs add --input definition.json
node tools/research-watch.mjs list | show id | history id [--limit N --offset N --all]
node tools/research-watch.mjs run id --once [--key id] [--write --allow-private]
node tools/research-watch.mjs enable|disable|remove id [--actor name --reason text]
node tools/research-watch.mjs due --once --network [--limit N --max-requests N --write --allow-private]
node tools/research-watch.mjs report delivery-id [--write --allow-private]
All: --data-dir path --scope private|public --json. Reads never init/migrate/acquire.
Tests only: --http-fixture file [--at UTC] runs E1 with JSON transport, never network.
Pinned GitHub retrieval requires --mode pinned-audit --repo owner/name --ref SHA [--file path]; immutable SHA is an availability/integrity audit.
Enable only marks desired state. due is finite, serial, explicit. Remove archives.
Report --write is explicit local publication; private export requires --allow-private.
No OS registration, foreground loop, webhook, deployment or automatic truth verdict.
Exit: 0 success; 1 acquisition/storage/partial failure; 2 usage; 130 cancellation.`;
const byCommand={migrate:['backup'],add:['input','name','source','url','query','repo','ref','file','mode','config','interval','timezone','out','brief','actor','max-pending','history-days'],
  list:['limit','offset'],show:[],history:['limit','offset','all'],run:['once','key','write','allow-private'],
  enable:['actor','reason'],disable:['actor','reason'],remove:['actor','reason'],due:['once','network','limit','max-requests','write','allow-private'],report:['write','allow-private']};
const bool=new Set(['json','all','once','network','write','allow-private']);
export async function main(args){
  if(args.length===1&&args[0]==='--help'){console.log(HELP);return 0;}
  const [command,...rest]=args,o={},pos=[];
  try{
    if(!Object.hasOwn(byCommand,command))throw Error();
    const allowed=[...byCommand[command],'data-dir','scope','json','http-fixture','at'];
    for(let i=0;i<rest.length;i++){
      if(!rest[i].startsWith('--')){pos.push(rest[i]);continue;}const key=rest[i].slice(2);
      if(!allowed.includes(key)||key in o)throw Error();if(bool.has(key))o[key]=true;
      else if(rest[i+1]&&!rest[i+1].startsWith('--'))o[key]=rest[++i];else throw Error();
    }
    if(pos.length!==(['show','history','run','enable','disable','remove','report'].includes(command)?1:0))throw Error();
    if(['run','due'].includes(command)&&!o.once)throw Error();
    if(command==='due'&&!o['http-fixture']&&!o.network)throw Error();
    if(o.at&&!o['http-fixture'])throw Error();
    if(command==='add'&&o.input&&byCommand.add.some(k=>k!=='input'&&o[k]!==undefined))throw Error();
  }catch{console.error('Invalid arguments. Run with --help.');return 2;}
  let watch;const controller=new AbortController(),cancel=()=>controller.abort();process.once('SIGINT',cancel);
  try{
    const base={dataDir:o['data-dir'],scope:o.scope||'private',...(o.at?{clock:()=>o.at}:{})};
    let result;
    if(command==='migrate')result=await migrateToV3({...base,backup:o.backup});
    else{
      const deps=o['http-fixture']?{harness:fixtureTransport(jsonFile(o['http-fixture']))}:{};
      watch=openWatch({...base,write:['add','run','enable','disable','remove','due'].includes(command)||!!o.write},deps);
      const settings={write:!!o.write,allowPrivate:!!o['allow-private'],signal:controller.signal};
      if(command==='add'){
        const input=o.input?jsonFile(o.input):Object.fromEntries(['name','source','url','query','repo','ref','file','mode','interval','timezone','out','brief','actor'].filter(k=>o[k]!==undefined).map(k=>[k,o[k]]));
        if(o.config)input.config=jsonFile(o.config);if(o['max-pending'])input.maxPending=Number(o['max-pending']);if(o['history-days'])input.historyDays=Number(o['history-days']);result=watch.add(input);
      }else if(command==='list')result=watch.list({...(o.limit?{limit:Number(o.limit)}:{}),...(o.offset?{offset:Number(o.offset)}:{})});
      else if(command==='show')result=watch.show(pos[0]);
      else if(command==='history')result=watch.history(pos[0],{all:!!o.all,...(o.limit?{limit:Number(o.limit)}:{}),...(o.offset?{offset:Number(o.offset)}:{})});
      else if(command==='run')result=await watch.run(pos[0],{...settings,key:o.key});
      else if(command==='due')result=await watch.due({...settings,...(o.limit?{limit:Number(o.limit)}:{}),...(o['max-requests']?{maxRequests:Number(o['max-requests'])}:{})});
      else if(['enable','disable','remove'].includes(command))result=watch.control(pos[0],command.toUpperCase(),{actor:o.actor,reason:o.reason});
      else if(command==='report')result=o.write?watch.deliver(pos[0],settings):watch.report(pos[0]);
    }
    encode(result);console.log(JSON.stringify({status:'OK',...result,watch:'OFF'},null,o.json?2:0));
    if(controller.signal.aborted)return 130;
    return result.status&&!['OK','DISABLED','ENABLED'].includes(result.status)||result.results?.some(r=>r.status&&!['OK','NOT_DUE'].includes(r.status))?1:0;
  }catch(error){console[ o.json?'log':'error'](JSON.stringify({status:code(error),watch:'OFF'}));return controller.signal.aborted?130:1;}
  finally{watch?.close();process.removeListener('SIGINT',cancel);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main(process.argv.slice(2));
