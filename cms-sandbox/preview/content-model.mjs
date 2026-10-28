export const contentTypes = {
  people: { label: '참여자', headers: ['section','section_en','category','category_en','order','person_order','name','name_en','role','role_en','start_year','end_year','project','project_en','profile_url','note','note_en','status','public'] },
  education: { label: '특강·워크숍', headers: ['date','slug','type','type_en','title','title_en','speaker','speaker_en','description','description_en','materials'] },
  research: { label: '연구 프로젝트', headers: ['project_group','project_group_en','title','title_en','status','description','description_en','url','order'] },
};
export const contentLabels = { section:'구분',section_en:'구분 · 영문',category:'분류',category_en:'분류 · 영문',order:'표시 순서',person_order:'분류 안의 순서',name:'이름',name_en:'이름 · 영문',role:'역할',role_en:'역할 · 영문',start_year:'참여 시작 연도',end_year:'참여 종료 연도',project:'참여 내용',project_en:'참여 내용 · 영문',profile_url:'프로필 링크',note:'분류 안내',note_en:'분류 안내 · 영문',public:'공개 여부',date:'날짜',slug:'기존 주소',type:'유형',type_en:'유형 · 영문',title:'제목',title_en:'제목 · 영문',speaker:'강연자·진행자',speaker_en:'강연자·진행자 · 영문',description:'소개',description_en:'소개 · 영문',materials:'첨부 자료',project_group:'프로젝트 묶음',project_group_en:'프로젝트 묶음 · 영문',status:'진행 상태',url:'연결 주소' };
export function parseContentCsv(text, kind) {
  const expected = contentTypes[kind]?.headers;
  if (!expected) throw Error('관리할 자료 종류를 확인해 주세요.');
  const lines = []; let row = [], value = '', quoted = false;
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if (c==='"' && quoted && text[i+1]==='"') { value+='"'; i++; }
    else if (c==='"') quoted=!quoted;
    else if (c===',' && !quoted) { row.push(value); value=''; }
    else if ((c==='\n'||c==='\r')&&!quoted) { if(c==='\r'&&text[i+1]==='\n')i++; row.push(value); if(row.some(x=>x!=='')) lines.push(row); row=[];value=''; }
    else value+=c;
  }
  if(quoted) throw Error('자료의 따옴표가 닫히지 않았습니다.');
  row.push(value); if(row.some(x=>x!==''))lines.push(row);
  const headers=lines.shift()||[]; if(headers.length)headers[0]=headers[0].replace(/^\uFEFF/,'');
  if(JSON.stringify(headers)!==JSON.stringify(expected)||lines.some(r=>r.length!==headers.length)) throw Error('기존 자료의 열 구성을 확인해 주세요.');
  return lines.map(r=>Object.fromEntries(headers.map((key,i)=>[key,r[i]])));
}
export function contentCsv(kind, rows) {
  const escape=value=>'"'+String(value??'').replaceAll('"','""')+'"';
  return contentTypes[kind].headers.join(',')+'\n'+rows.map(row=>contentTypes[kind].headers.map(key=>escape(row[key])).join(',')).join('\n')+'\n';
}
export const originKey=(kind,index)=>kind+'-'+String(index+1).padStart(4,'0');
const plain=value=>value==null?'':typeof value==='string'&&value.length<=30000?value:(()=>{throw Error('입력값의 형식이나 길이를 확인해 주세요.');})();
function link(value) { if(!value)return; let url;try{url=new URL(value);}catch{throw Error('http:// 또는 https://로 시작하는 링크를 입력해 주세요.');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('로그인 정보가 없는 웹 링크를 입력해 주세요.'); }
export function compileContent({kind,form,sourceRows,sourceHash,commit,baseCommit,tree}) {
  const definition=contentTypes[kind];
  if(!definition||!form||form.source_sha256!==sourceHash) throw Error('공개 자료의 기준이 달라졌습니다. 사본을 먼저 확인해 주세요.');
  if(!/^[0-9a-f]{40}$/.test(commit||'')||!/^[0-9a-f]{40}$/.test(baseCommit||'')) throw Error('저장본을 확인하지 못했습니다.');
  if(!Array.isArray(form.records)||form.records.length>500) throw Error('목록은 500개 항목 이내로 입력해 주세요.');
  const origins=new Map(sourceRows.map((row,i)=>[originKey(kind,i),row])), seen=new Set(), resources={}, changes=[];
  const blobs=new Map(tree.filter(f=>f.type==='blob').map(f=>[f.path,f]));
  const rows=form.records.map((record,index)=>{
    if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).some(k=>!definition.headers.includes(k)&&k!=='origin_key'))throw Error('알 수 없는 입력 항목이 있습니다.');
    const key=plain(record.origin_key), existing=key?origins.get(key):null;
    if(key&&(!existing||seen.has(key))) throw Error('기존 항목 식별자가 겹치거나 달라졌습니다.');
    if(key) seen.add(key);
    const row=Object.fromEntries(definition.headers.map(k=>[k,plain(record[k])]));
    const requireFields=kind==='people'?['section','category']:kind==='education'?['title','date','type']:['title','project_group'];
    for(const field of requireFields)if(!row[field].trim())throw Error((index+1)+'번: '+contentLabels[field]+'을 입력해 주세요.');
    if(kind==='people') {
      if(!row.name.trim()&&!row.note.trim())throw Error((index+1)+'번: 이름 또는 분류 안내를 입력해 주세요.');
      if(!['','yes','no'].includes(row.public))throw Error('공개 여부를 다시 선택해 주세요.');
      link(row.profile_url);
      if(existing&&['start_year','end_year','status'].some(k=>row[k]!==existing[k]))throw Error('기존 참여 연도와 내부 참여 상태는 유지해 주세요.');
    }
    if(kind==='research')link(row.url);
    for(const field of ['order','person_order'])if(row[field]&&!/^[0-9]{1,4}$/.test(row[field]))throw Error('표시 순서는 0~9999 사이의 정수로 입력해 주세요.');
    if(kind==='education') {
      const parts=row.date.match(/^([1-9][0-9]{3})(?:-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]))?$/);
      if(!parts||(parts[2]&&new Date(Date.UTC(+parts[1],+parts[2]-1,+parts[3])).toISOString().slice(0,10)!==row.date))throw Error('날짜는 2026-10-29 또는 2026 형식으로 입력해 주세요.');
      if(existing&&row.slug!==existing.slug)throw Error('기존 자료의 주소는 유지해 주세요.');
      if(!existing&&row.slug)throw Error('새 자료의 주소는 공개 반영 단계에서 정합니다.');
      const media=row.materials.replace(/^\//,'');
      if(media) {
        if(!media.startsWith('cms-sandbox/media/education/')||/[\\?#%\x00-\x1f]/.test(media)||media.split('/').some(p=>p==='.'||p==='..')||!/[.](?:jpg|jpeg|png|webp|pdf)$/i.test(media))throw Error('특강·워크숍 사본에서 첨부 자료를 선택해 주세요.');
        const file=blobs.get(media);
        if(!file||file.mode!=='100644'||file.size>20*1024*1024)throw Error('첨부 자료가 없거나 20 MB 한도를 넘었습니다.');
        const ext=media.split('.').pop().toLowerCase();
        resources[media]={path:media,bytes:file.size,mime:ext==='pdf'?'application/pdf':ext==='png'?'image/png':ext==='webp'?'image/webp':'image/jpeg'};
      }
    }
    const baseline=existing?{...existing}:null;
    if(baseline?.materials?.startsWith('assets/media/education/'))baseline.materials='/cms-sandbox/media/education/'+baseline.materials.slice('assets/media/education/'.length);
    const fields=definition.headers.filter(k=>row[k]!== (baseline?.[k]??''));
    const oldPosition=key?sourceRows.indexOf(origins.get(key)):-1;
    if(!existing||fields.length||oldPosition!==index)changes.push({label:row.name||row.title||row.category,status:existing?'changed':'added',moved:!!existing&&oldPosition!==index,fields:fields.map(k=>({key:k,label:contentLabels[k]||k,before:baseline?.[k]||'',after:row[k]}))});
    return row;
  });
  for(const [key,row]of origins)if(!seen.has(key))changes.push({label:row.name||row.title||row.category,status:'removed',fields:[]});
  const displayRows=rows.map((row,index)=>kind==='education'&&!row.slug?{...row,slug:'draft-'+(index+1)}:row);
  const ids=kind==='education'?displayRows.map(r=>r.date.slice(0,4)+'-'+r.slug):[];
  if(new Set(ids).size!==ids.length)throw Error('같은 연도에 겹치는 자료 주소가 있습니다. 날짜와 기존 주소를 확인해 주세요.');
  return {schema:1,kind,label:definition.label,commit,baseCommit,rows,displayRows,resources,changes,sourceCount:sourceRows.length};
}
