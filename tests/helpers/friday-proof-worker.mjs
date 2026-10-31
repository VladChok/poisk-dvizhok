// Fresh-process offline proof driver. Real E1/E2/E3/E4; only HTTP/DNS replaced.
import {openWatch} from '../../watch/store.mjs';
import {createHarness} from '../../harness/engine.mjs';
const [dataDir,id,phase,at]=process.argv.slice(2),a='https://feeds.example.com/feed',b='https://feeds.example.com/other',calls=[];
const config={allowedHosts:['feeds.example.com'],feeds:[a],limits:{retries:0,minIntervalMs:0}};
const reply=(text,status=200,extra={})=>({status,headers:{'content-type':'application/rss+xml',etag:'"shared"',...extra},body:`<rss><channel><item><guid>one</guid><description>${text}</description></item></channel></rss>`});
const harness={token:'',lookup:async()=>[{address:'8.8.8.8',family:4}],wire:async(url,o)=>{
  calls.push({url:url.href,etag:o.headers['if-none-match']||null,lastModified:o.headers['if-modified-since']||null});
  if(phase==='initial')return url.href===a?reply('',302,{location:b}):reply('OLD B');
  if(phase==='changed')return o.headers['if-none-match']==='"shared"'?reply('',304):reply('NEW A');
  if(phase==='introduce')return url.href===a?reply('',307,{location:b}):o.headers['if-none-match']?reply('',304):reply('NEW B');
  if(phase==='due')return reply('scheduled');throw Error('Unexpected proof phase');
}};
const w=openWatch({dataDir,scope:'public',write:true,clock:()=>at},{harness});
try{
  const outcome=phase==='due'?await w.due():await w.run(id),control=phase==='changed'?await createHarness(config,harness).retrieve('rss',{url:a}):null;
  console.log(JSON.stringify({outcome,control,calls,watch:'OFF'}));
}finally{w.close();}
