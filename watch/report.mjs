import fs from 'node:fs';
import path from 'node:path';
import {encode, identity} from '../analysis/records.mjs';
import {literal} from '../analysis/store.mjs';
import {safePath, temporary, publishFile, syncFile, fail} from '../memory/safety.mjs';
export function render(report) {
  const lines=[`# Local WATCH report ${literal(report.watch.name)}`,'',`UTC ${literal(report.at)}; display timezone ${literal(report.watch.timezone)}.`,
    '','Recorded representations only. No verified factual contradiction, confirmed deletion or proof of absence.','',`Acquisition ${literal(report.acquisitionStatus)}; run ${literal(report.runId)}; coverage ${literal(report.coverageId)}.`,''];
  for(const d of report.deltas){
    lines.push(`- ${literal(d.kind)}: ${literal(d.identity)} — ${literal(d.reason)}`,`  - E3 comparison ${literal(d.comparisonId)}; changed fields ${literal((d.changedFields||[]).join(', '))}`);
    for(const [side,item] of [['Left',d.left],['Right',d.right]]) lines.push(`  - ${side}: ${literal(item?.pointer?.locator)} @ ${literal(item?.pointer?.version)}; check ${literal(item?.checkId)}; revision ${literal(item?.revisionId)}; retrieved ${literal(item?.retrievedAt)}; published ${literal(item?.publishedAt)}; updated ${literal(item?.updatedAt)}; event ${literal(item?.eventAt)}`);
    if(d.validatedBy)lines.push(`  - Validated cached membership with actual root check ${literal(d.validatedBy)}; no new entry bytes.`);
  }
  lines.push('',`Recorded request: ${literal(JSON.stringify(report.request))}`,`Coverage: ${literal(JSON.stringify(report.coverage.counters))}; ${literal(report.coverage.assessment)}`,
    `Limitations: ${report.limitations.map(literal).join(', ')}`,'','Absence NOT_PROVEN. No background worker was installed or started by this report.');
  return lines.join('\n')+'\n';
}
// Durable idempotent local publication. The ownership manifest permits resuming
// a partial directory; unknown destinations are never adopted or overwritten.
export function publish(report,root,{afterFiles}={}) {
  const output=safePath(path.join(root,report.id));
  const files={'.gitignore':'*\n','report.json':encode(report)+'\n','REPORT.md':render(report)};
  const manifest=encode({version:1,id:report.id,files:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,identity(v)]))})+'\n';
  fs.mkdirSync(safePath(root),{recursive:true,mode:0o700});
  const staged=temporary(output);fs.mkdirSync(staged,{mode:0o700});
  try{
    for(const [file,bytes]of Object.entries({...files,'manifest.json':manifest})){fs.writeFileSync(path.join(staged,file),bytes,{flag:'wx',mode:0o600});syncFile(path.join(staged,file));}
    let owned=false;
    try{fs.mkdirSync(output,{mode:0o700});owned=true;}catch(e){if(e.code!=='EEXIST')throw e;}
    if(owned){publishFile(path.join(staged,'.gitignore'),path.join(output,'.gitignore'));publishFile(path.join(staged,'manifest.json'),path.join(output,'manifest.json'));}
    else if(!fs.statSync(output).isDirectory()||!fs.existsSync(safePath(path.join(output,'manifest.json')))||fs.statSync(path.join(output,'manifest.json')).size!==Buffer.byteLength(manifest)||fs.readFileSync(safePath(path.join(output,'manifest.json')),'utf8')!==manifest)fail('TARGET_EXISTS');
    if(fs.readdirSync(output).some(f=>!['manifest.json',...Object.keys(files)].includes(f)))fail('TARGET_EXISTS');
    for(const [file,bytes]of Object.entries(files)){
      const destination=safePath(path.join(output,file));
      if(!fs.existsSync(destination)){
        try{publishFile(path.join(staged,file),destination);}catch(e){if(e.code!=='EEXIST')throw e;}
      }
      if(!fs.lstatSync(destination).isFile()||fs.statSync(destination).size!==Buffer.byteLength(bytes)||fs.readFileSync(destination,'utf8')!==bytes)fail('REPORT_CONTENT_MISMATCH');
    }
    afterFiles?.();return {id:report.id,files:['report.json','REPORT.md','manifest.json'],verified:true};
  }finally{fs.rmSync(staged,{recursive:true,force:true});}
}
