export const categories=[['concerts','공연 아카이브'],['research','연구 프로젝트'],['education','특강과 워크숍'],['people','EEAMS의 구성과 참여']];
const categoryIds=new Set(categories.map(c=>c[0]));
const kinds=new Set(['visit','category_entry','detail_open','attachment_open','research_outbound_open']);
const materialKinds=new Set(['detail_open','attachment_open','research_outbound_open']);
const fields=['version','eventId','sessionId','sessionStartedAt','occurredAt','kind','category','contentId'];
const identifier=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
export function instant(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))throw Error('시각 형식을 확인해 주세요.');
 const n=Date.parse(value);if(!Number.isFinite(n)||new Date(n).toISOString()!==value)throw Error('실제 날짜와 시각을 확인해 주세요.');return n;
}
export function dayStart(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('조회 날짜를 확인해 주세요.');
 const n=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==value)throw Error('실제 날짜를 확인해 주세요.');return n-9*3600000;
}
const month=value=>new Date(value+9*3600000).toISOString().slice(0,7);
export function advanceSession(previous,now,newId){
 if(!Number.isFinite(now)||!identifier(newId))throw Error('시험 방문 상태를 확인해 주세요.');
 const valid=previous&&identifier(previous.id)&&Number.isFinite(previous.startedAt)&&Number.isFinite(previous.lastActivity)&&previous.startedAt<=previous.lastActivity&&previous.lastActivity<=now;
 if(!valid||now-previous.lastActivity>=30*60000)return{isNew:true,session:{id:newId,startedAt:now,lastActivity:now}};
 return{isNew:false,session:{...previous,lastActivity:now}};
}
export function validateEvent(event,registry){
 if(!event||typeof event!=='object'||Array.isArray(event)||Object.keys(event).length!==fields.length||Object.keys(event).some(k=>!fields.includes(k))||fields.some(k=>!(k in event)))throw Error('허용한 집계 항목만 사용할 수 있습니다.');
 if(event.version!==1||!identifier(event.eventId)||!identifier(event.sessionId)||!kinds.has(event.kind))throw Error('집계 행동 형식을 확인해 주세요.');
 const at=instant(event.occurredAt),startedAt=instant(event.sessionStartedAt);if(at<startedAt)throw Error('방문 시작과 행동 시각이 맞지 않습니다.');
 if(event.kind==='visit'){
  if(event.category!==null||event.contentId!==null)throw Error('방문에는 개인이나 콘텐츠 대상을 넣지 않습니다.');
 }else{
  if(!categoryIds.has(event.category))throw Error('허용한 분야만 집계합니다.');
  if(event.kind==='category_entry'){
   if(event.contentId!==event.category)throw Error('분야 이동 대상을 확인해 주세요.');
  }else{
   const target=registry.find(r=>r.id===event.contentId&&r.category===event.category);
   if(!target||typeof target.title!=='string'||!target.actions.includes(event.kind))throw Error('공개 자료의 고정 번호를 확인해 주세요.');
   if(event.category==='people'&&(event.contentId!=='people-index'||event.kind!=='detail_open'))throw Error('개인별 관심 순위는 집계하지 않습니다.');
   if(event.kind==='research_outbound_open'&&event.category!=='research')throw Error('연구 연결만 집계합니다.');
  }
 }
 return{...event,at,startedAt};
}
