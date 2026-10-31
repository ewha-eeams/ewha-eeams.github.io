// Copy-only publication for a complete content list. Never used by ActualPublisher.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { contentTypes, parseContentCsv, contentCsv, compileContent, originKey } from './content-model.mjs';
import { createLocalPublicationCopy, LocalPublicationCopy } from './publication-copy.mjs';
import { assertCurrent } from './review-model.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const blobHash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const json = data => Buffer.from(JSON.stringify(data, null, 2) + '\n');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (message, code = 'CONTENT_COPY_ERROR') => Object.assign(new Error(message), { code });
const mediaPath = path => /^assets\/media\/education\/cms\/[0-9a-f]{40}(?:-poster)?\.(?:jpg|jpeg|png|webp|pdf)$/.test(path);
export const allowedContentPublicPath = (kind, path) => Object.hasOwn(contentTypes, kind) && (path === `data/${kind}.csv` || (kind === 'education' && mediaPath(path)));
const mirror = path => 'cms-sandbox/media/education/' + path.slice('assets/media/education/'.length);
const validMedia = (path, bytes) => /\.pdf$/i.test(path) ? bytes.subarray(0,5).toString() === '%PDF-' : /\.png$/i.test(path) ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : /\.webp$/i.test(path) ? bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP' : bytes[0]===255 && bytes[1]===216;

export function prepareContentPlan({ kind, form, sourceCsv, baseTree, draftTree, baseCommit, draftCommit }) {
  const sourceRows = parseContentCsv(sourceCsv.toString('utf8'), kind);
  const snapshot = compileContent({kind, form, sourceRows, sourceHash:hash(sourceCsv), commit:draftCommit, baseCommit, tree:draftTree});
  if (!snapshot.changes.length) throw fail('사본에 반영할 변경이 없습니다.');
  const rows = structuredClone(snapshot.rows), mapping = [], operations = [], used = new Set(sourceRows.map(r => r.date?.slice(0,4)+'-'+r.slug));
  for (const row of rows) if (row.slug) used.add(row.date.slice(0,4)+'-'+row.slug);
  const baseFiles = new Map(baseTree.filter(f => f.type==='blob').map(f => [f.path,f]));
  const draftFiles = new Map(draftTree.filter(f => f.type==='blob').map(f => [f.path,f]));
  rows.forEach((row,index) => {
    if (kind !== 'education') return;
    if (!row.slug) { let n=1; while(used.has(row.date.slice(0,4)+'-event'+n)) n++; row.slug='event'+n; used.add(row.date.slice(0,4)+'-'+row.slug); }
    mapping.push({label:row.title,publicId:row.date.slice(0,4)+'-'+row.slug,added:!form.records[index].origin_key});
    if (!row.materials) return;
    const sourcePath=row.materials.replace(/^\//,''), file=draftFiles.get(sourcePath);
    const original='assets/media/education/'+sourcePath.slice('cms-sandbox/media/education/'.length), existing=baseFiles.get(original);
    if (existing?.mode==='100644' && existing.sha===file.sha && existing.size===file.size) { row.materials=original; return; }
    // Preserve the public renderer's poster label when assigning a safe new path.
    const role=/-poster\.(?:jpe?g|png|pdf)$/i.test(sourcePath)?'-poster':'';
    const target='assets/media/education/cms/'+file.sha+role+'.'+sourcePath.split('.').pop().toLowerCase(), collision=baseFiles.get(target);
    if (collision && (collision.mode!=='100644'||collision.sha!==file.sha||collision.size!==file.size)) throw fail('첨부 자료의 새 주소가 기존 파일과 겹칩니다.');
    if (!operations.some(op=>op.path===target)) operations.push({path:target,sourcePath,sha:file.sha,size:file.size,action:collision?'reuse':'add'});
    row.materials=target;
  });
  if (operations.length>100 || operations.reduce((n,o)=>n+o.size,0)>80*1024*1024) throw fail('이번 사본 시험의 첨부 자료 크기를 줄여 주세요.');
  const csv=contentCsv(kind,rows);
  return {schema:1,copyOnly:true,productionPublished:false,kind,baseCommit,draftCommit,csv,rows,mapping,changes:snapshot.changes,operations};
}

export class ContentPublicationCopy {
  constructor(store) { this.store=store; }
  current() { return this.store.current(); }
  read(kind,refs=this.current()) {
    const sourceCsv=this.store.bytes(refs.baseCommit,`data/${kind}.csv`), form=JSON.parse(this.store.bytes(refs.draftCommit,`cms-sandbox/content/${kind}.json`));
    return {kind,form,sourceCsv,baseTree:this.store.tree(refs.baseCommit),draftTree:this.store.tree(refs.draftCommit),...refs};
  }
  snapshot(kind,refs=this.current()) {
    const data=this.read(kind,refs);
    return compileContent({kind,form:data.form,sourceRows:parseContentCsv(data.sourceCsv.toString('utf8'),kind),sourceHash:hash(data.sourceCsv),commit:refs.draftCommit,baseCommit:refs.baseCommit,tree:data.draftTree});
  }
  async publish(plan,digest,{fault=async()=>{}}={}) {
    await this.store.verify();
    if (hash(JSON.stringify(plan))!==digest) throw fail('확인한 변경 내용과 요청이 다릅니다.');
    const journalPath=join(this.store.directory,'content-publication-result.json'); let report;
    try { report=JSON.parse(await readFile(journalPath,'utf8')); } catch(error) { if(error.code!=='ENOENT')throw error; }
    if (report && report.digest!==digest) throw fail('다른 반영에 사용한 사본입니다.');
    const current=this.current();
    if (report && current.baseCommit===report.publicCommit && current.draftCommit===report.cmsCommit) { await this.check(report); return {...report,repeated:true}; }
    assertCurrent(plan,current);
    if (!report) {
      const input=this.read(plan.kind,current);
      if (JSON.stringify(prepareContentPlan(input))!==JSON.stringify(plan)) throw fail('검토 이후 자료가 달라졌습니다.');
      const publicPatches=new Map([[`data/${plan.kind}.csv`,Buffer.from(plan.csv)]]), cmsMedia=new Map();
      for (const op of plan.operations) {
        const bytes=this.store.bytes(plan.draftCommit,op.sourcePath);
        if (bytes.length!==op.size || blobHash(bytes)!==op.sha || !validMedia(op.path,bytes)) throw fail('첨부 파일의 저장본이나 형식을 확인해 주세요.');
        if(op.action==='add')publicPatches.set(op.path,bytes);
        cmsMedia.set(mirror(op.path),bytes);
      }
      const publicCommit=await this.store.commit(plan.baseCommit,publicPatches,'Content publication copy '+digest,path=>allowedContentPublicPath(plan.kind,path));
      const nextForm=structuredClone(input.form); nextForm.source_sha256=hash(plan.csv);
      nextForm.records=nextForm.records.map((record,index)=>{
        const next={...record,origin_key:originKey(plan.kind,index)};
        if(plan.kind==='education') {next.slug=plan.rows[index].slug;if(plan.rows[index].materials)next.materials='/'+mirror(plan.rows[index].materials);}
        return next;
      });
      const ledger={schema:1,copyOnly:true,productionPublished:false,kind:plan.kind,digest,previousPublicCommit:plan.baseCommit,previousCmsCommit:plan.draftCommit,publicCommit,source_sha256:nextForm.source_sha256,mapping:plan.mapping};
      const ledgerPath=`cms-sandbox/content-publications/${digest}.json`, formPath=`cms-sandbox/content/${plan.kind}.json`;
      const patches=new Map([...publicPatches,...cmsMedia,[formPath,json(nextForm)],[ledgerPath,json(ledger)]]);
      const allowed=path=>allowedContentPublicPath(plan.kind,path)||cmsMedia.has(path)||path===formPath||path===ledgerPath;
      const cmsCommit=await this.store.commit(plan.draftCommit,patches,'Content CMS synchronization copy '+digest,allowed);
      const after=this.snapshot(plan.kind,{baseCommit:publicCommit,draftCommit:cmsCommit});
      if(after.changes.length || after.rows.length!==plan.rows.length)throw fail('게시 후 CMS 기준 갱신이 일치하지 않습니다.');
      const preservedKinds=Object.keys(contentTypes).filter(kind=>kind!==plan.kind);
      for(const kind of preservedKinds)for(const path of [`cms-sandbox/content/${kind}.json`,`data/${kind}.csv`])if(!this.store.bytes(plan.draftCommit,path).equals(this.store.bytes(cmsCommit,path)))throw fail('선택하지 않은 자료가 바뀌었습니다.');
      report={...ledger,changes:plan.changes,cmsCommit,records:after.rows.length,remainingChanges:0,preservedKinds,publicFiles:[...publicPatches.keys()],cmsFiles:[...patches.keys()],mediaBytes:plan.operations.reduce((n,o)=>n+o.size,0)};
      await writeFile(journalPath+'.pending',json(report));await rename(journalPath+'.pending',journalPath);
    }
    await this.check(report); await fault('before-transaction',this,report);
    try {this.store.git(['update-ref','--stdin'],{input:`start\nupdate refs/heads/site-copy ${report.publicCommit} ${plan.baseCommit}\nupdate refs/heads/cms-copy ${report.cmsCommit} ${plan.draftCommit}\nprepare\ncommit\n`});}
    catch {throw fail('검토 뒤 사본이 바뀌어 양쪽 반영을 중단했습니다.','STALE_REVIEW');}
    await fault('after-transaction',this,report);
    return {...report,repeated:false};
  }
  async check(report) {
    if(report.schema!==1||report.copyOnly!==true||report.productionPublished!==false||!Object.hasOwn(contentTypes,report.kind)||!/^[0-9a-f]{64}$/.test(report.digest||'')||![report.publicCommit,report.cmsCommit,report.previousPublicCommit,report.previousCmsCommit].every(s=>/^[0-9a-f]{40}$/.test(s||'')))throw fail('사본 반영 기록을 확인해 주세요.');
    for(const [child,parent]of [[report.publicCommit,report.previousPublicCommit],[report.cmsCommit,report.previousCmsCommit]])if(this.store.git(['rev-parse',`${child}^`],{encoding:'utf8'}).trim()!==parent)throw fail('사본 변경 이력이 다릅니다.');
    if(hash(this.store.bytes(report.publicCommit,`data/${report.kind}.csv`))!==report.source_sha256)throw fail('사본의 게시 자료가 다릅니다.');
    const ledger=JSON.parse(this.store.bytes(report.cmsCommit,`cms-sandbox/content-publications/${report.digest}.json`));
    if(ledger.digest!==report.digest||ledger.publicCommit!==report.publicCommit)throw fail('사본 동기화 기록이 다릅니다.');
    const after=this.snapshot(report.kind,{baseCommit:report.publicCommit,draftCommit:report.cmsCommit});
    if(after.changes.length)throw fail('사본 기준 갱신이 완료되지 않았습니다.');
  }
}

export function createContentCopyService({reader,sourceRepository,artifactRoot}) {
  const plans=new Map(),active=new Set(),ttl=30*60*1000;
  const directory=id=>{if(!uuid.test(id||''))throw fail('사본 결과 주소를 확인해 주세요.');return join(artifactRoot,'content-copy',id);};
  const find=async id=>{
    const folder=directory(id),report=JSON.parse(await readFile(join(folder,'result.json'),'utf8'));
    const copy=new ContentPublicationCopy(new LocalPublicationCopy(join(folder,'publication.git')));
    await copy.store.verify();await copy.check(report);return {folder,copy,report};
  };
  return {
    isBusy() {return active.size>0;},
    async prepare(kind,expected) {
      if(!Object.hasOwn(contentTypes,kind))throw fail('관리할 자료 종류를 확인해 주세요.');
      const refs=await reader.refs();assertCurrent(expected,refs);
      const [sourceCsv,bytes,baseTree,draftTree]=await Promise.all([reader.bytes(refs.baseCommit,`data/${kind}.csv`),reader.bytes(refs.draftCommit,`cms-sandbox/content/${kind}.json`),reader.tree(refs.baseCommit),reader.tree(refs.draftCommit)]);
      if(bytes.length>1024*1024)throw fail('자료 목록의 크기를 확인해 주세요.');
      const plan=prepareContentPlan({kind,sourceCsv,form:JSON.parse(bytes.toString('utf8')),baseTree,draftTree,...refs});assertCurrent(refs,await reader.refs());
      for(const[id,item]of plans)if(Date.now()-item.created>ttl)plans.delete(id);
      if(plans.size>=100)throw fail('사본 확인 창을 정리한 뒤 다시 진행해 주세요.');
      const id=randomUUID(),digest=hash(JSON.stringify(plan));plans.set(id,{plan,digest,created:Date.now()});
      return {id,digest,kind,copyOnly:true,productionPublished:false,changes:plan.changes,mapping:plan.mapping,records:plan.rows.length,operations:[{path:`data/${kind}.csv`,action:'update'},...plan.operations.map(({path,action,size})=>({path,action,size}))]};
    },
    async apply(id,digest) {
      const item=plans.get(id);
      if(!item||Date.now()-item.created>ttl||item.digest!==digest)throw fail('검토 화면을 새로 불러온 뒤 다시 진행해 주세요.','EXPIRED_REVIEW');
      if(active.has(id))throw fail('같은 사본을 처리하고 있습니다. 잠시 기다려 주세요.');
      assertCurrent(item.plan,await reader.refs());active.add(id);
      try {
        const folder=directory(id);await mkdir(folder,{recursive:true});let store;
        try {store=await createLocalPublicationCopy({directory:join(folder,'publication.git'),sourceRepository:reader.copySource||sourceRepository,...item.plan});}
        catch(error){if(error.code!=='EEXIST')throw error;store=new LocalPublicationCopy(join(folder,'publication.git'));}
        const report=await new ContentPublicationCopy(store).publish(item.plan,digest);assertCurrent(item.plan,await reader.refs());
        await writeFile(join(folder,'result.json'),json(report));return {...report,id,report:`/api/content-copy/report?id=${id}`};
      }finally{active.delete(id);}
    },
    async report(id) {return (await find(id)).report;},
    async proof(id) {
      const {copy,report}=await find(id);
      const plan=prepareContentPlan(copy.read(report.kind,{baseCommit:report.previousPublicCommit,draftCommit:report.previousCmsCommit}));
      const digest=hash(JSON.stringify(plan));
      if(digest!==report.digest)throw fail('사본에서 확인한 변경 내용과 다릅니다.');
      assertCurrent(plan,await reader.refs());
      return {id,plan,digest,proof:{directory:copy.store.directory,report}};
    },
    async snapshot(id) {const{copy,report}=await find(id);return {...copy.snapshot(report.kind,{baseCommit:report.publicCommit,draftCommit:report.cmsCommit}),copyId:id};},
    async media(id,kind,commit,path) {
      const{copy,report}=await find(id),snapshot=copy.snapshot(report.kind,{baseCommit:report.publicCommit,draftCommit:report.cmsCommit});
      if(kind!==report.kind||commit!==report.cmsCommit||!Object.hasOwn(snapshot.resources,path))throw fail('사본 미리보기에서 자료를 다시 열어 주세요.','ENOENT');
      const bytes=copy.store.bytes(commit,path),resource=snapshot.resources[path];
      if(bytes.length!==resource.bytes||!validMedia(path,bytes))throw fail('사본 첨부 자료를 확인해 주세요.');
      return {bytes,mime:resource.mime};
    },
  };
}
