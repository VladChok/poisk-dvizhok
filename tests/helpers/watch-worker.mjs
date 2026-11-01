import {openWatch} from '../../watch/store.mjs';
import {code} from '../../memory/safety.mjs';
const [dataDir,id,at,mode]=process.argv.slice(2);let w;
try{
  w=openWatch({dataDir,scope:'public',write:true,clock:()=>at});const c=w.claim(id);
  console.log(JSON.stringify({status:'CLAIMED',attempt:c.attempt}));
  if(mode==='hold'){process.stdin.resume();process.stdin.on('data',()=>{w.close();process.exit(0);});}
  else w.close();
}catch(error){w?.close();console.log(JSON.stringify({status:code(error)}));process.exitCode=1;}
