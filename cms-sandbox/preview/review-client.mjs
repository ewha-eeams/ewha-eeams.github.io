const $ = id => document.getElementById(id);
let review, plan, reviewValid = false;
const selected = new Set();
const names = { poster: '포스터', pdf: '프로그램북 PDF', photos: '공연 사진' };
const actionNames = { add: '추가', replace: '교체', delete: '제외' };
const el = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
async function api(path, data) {
  const response = await fetch(path, data ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-EEAMS-Review': '1' }, body: JSON.stringify(data) } : { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.message || '처리하지 못했습니다. 다시 확인해 주세요.'); error.code = result.code; throw error; }
  return result;
}
function showError(error) {
  $('error').textContent = error.message; $('error').hidden = false;
  if (['STALE_REVIEW', 'EXPIRED_REVIEW'].includes(error.code)) { plan = null; reviewValid = false; $('prepared').hidden = true; $('result').hidden = true; $('prepare').disabled = true; $('status').textContent = '저장본이 달라져 다시 확인해야 합니다.'; }
  $('error').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function resetPlan() { plan = null; $('prepared').hidden = true; $('result').hidden = true; $('confirm').checked = false; $('rehearse').disabled = true; $('review-step').classList.add('current'); $('prepare-step').classList.remove('current'); }
function updateSelection() { resetPlan(); $('selected-count').textContent = `선택한 공연 ${selected.size}건`; $('prepare').disabled = !selected.size || !reviewValid; }
function valueColumn(value, label) { const column = el('div'); column.append(el('small', label, 'caption'), el('p', value || '—')); return column; }
function worksColumn(works, label) {
  const column = el('div'); column.append(el('strong', label, 'caption'));
  if (!works.length) column.append(el('p', '—'));
  else {
    const list = el('ol');
    works.forEach(work => { const values = [work.composer, work.composer_en, work.work_title, work.work_title_en, work.format, work.media_url].filter(Boolean); list.append(el('li', values.join('\n'))); });
    column.append(list);
  }
  return column;
}
function renderEntries() {
  $('entries').replaceChildren();
  const changed = review.entries.filter(e => e.status !== 'unchanged');
  if (!changed.length) {
    const empty = el('div', null, 'empty'); empty.append(el('strong', '공개 내용과 다른 저장된 변경이 없습니다.'), el('p', 'CMS에서 공연을 수정하고 Save한 뒤 다시 불러와 주세요.'));
    $('entries').append(empty); $('selection').hidden = true; return;
  }
  $('selection').hidden = false;
  changed.forEach(entry => {
    const card = el('article', null, 'entry'), heading = el('div', null, 'entry-heading'), label = el('label'), input = el('input'); input.type = 'checkbox'; input.value = entry.cms_id;
    const text = el('div'); text.append(el('strong', entry.title), el('small', `${entry.date} · ${entry.status === 'new' ? '새 공연' : '기존 공연 수정'}`)); label.append(input, text);
    const edit = el('a', 'CMS에서 수정 ↗'); edit.href = entry.editUrl; edit.target = '_blank'; edit.rel = 'noopener noreferrer';
    heading.append(label, edit); card.append(heading);
    const details = el('details'); details.open = true; details.append(el('summary', '변경 전후 보기'));
    const body = el('div', null, 'changes');
    entry.changes.forEach(change => { const row = el('div', null, 'field-change'); row.append(el('strong', change.label), valueColumn(change.before, '현재 공개'), valueColumn(change.after, '저장한 초안')); body.append(row); });
    if (entry.worksChanged) { const columns = el('div', null, 'work-comparison'); columns.append(worksColumn(entry.beforeWorks, `현재 공개 · ${entry.beforeWorks.length}곡`), worksColumn(entry.afterWorks, `저장한 초안 · ${entry.afterWorks.length}곡`)); body.append(columns); }
    entry.mediaChanges.forEach(kind => {
      const before = kind === 'photos' ? entry.beforeMedia.photos.map(p => p.path.split('/').pop()).join(', ') : entry.beforeMedia[kind]?.path.split('/').pop();
      const after = kind === 'photos' ? entry.afterMedia.photos.map(p => p.path.split('/').pop()).join(', ') : entry.afterMedia[kind]?.path.split('/').pop();
      body.append(el('p', before && before === after ? `${names[kind]}: 파일명은 같고 내용이 변경됐습니다.` : `${names[kind]}: ${before || '없음'} → ${after || '없음'}`, 'media-change'));
    });
    details.append(body); card.append(details); $('entries').append(card);
    input.addEventListener('change', () => { input.checked ? selected.add(entry.cms_id) : selected.delete(entry.cms_id); updateSelection(); });
  });
  $('entries').append(el('p', `나머지 변경 없는 공연 ${review.entries.length - changed.length}건은 그대로 유지합니다.`, 'muted'));
}
async function load() {
  $('reload').disabled = true; $('error').hidden = true; $('status').textContent = '공개 내용과 저장된 초안을 비교하는 중입니다.';
  $('entries').replaceChildren(); $('selection').hidden = true; selected.clear(); reviewValid = false; resetPlan();
  try {
    review = await api('/api/review'); reviewValid = true; renderEntries(); updateSelection();
    const changes = review.entries.filter(e => e.status !== 'unchanged').length;
    $('status').textContent = `저장된 공연 ${review.entries.length}건 · 변경 ${changes}건`;
  } catch (error) { showError(error); $('status').textContent = '최신 저장본을 확인하지 못했습니다.'; }
  finally { $('reload').disabled = false; }
}
$('reload').addEventListener('click', load);
$('prepare').addEventListener('click', async () => {
  $('prepare').disabled = true; $('error').hidden = true;
  try {
    plan = await api('/api/prepare', { reviewId: review.id, selectedIds: [...selected] });
    $('mapping').replaceChildren(); $('operations').replaceChildren(); $('operation-paths').replaceChildren(); $('confirm').checked = false; $('rehearse').disabled = true;
    plan.mapping.forEach(item => $('mapping').append(el('p', `${item.title} · ${item.existing ? '기존 주소 유지' : '새 공연 주소 준비'}`)));
    plan.operations.forEach(operation => {
      const kind = operation.path === 'data/archive.csv' ? '공연 정보' : operation.path.endsWith('-poster.jpg') ? '포스터' : operation.path.endsWith('-program-book.pdf') ? '프로그램북 PDF' : `공연 사진 ${operation.path.match(/-photo([0-9]+)\.jpg$/)?.[1] || ''}`;
      $('operations').append(el('li', `${kind} ${actionNames[operation.action]}`)); $('operation-paths').append(el('li', `${actionNames[operation.action]} · ${operation.path}`));
    });
    $('prepared').hidden = false; $('result').hidden = true; $('progress').textContent = ''; $('review-step').classList.remove('current'); $('prepare-step').classList.add('current');
    $('prepared').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { showError(error); }
  finally { $('prepare').disabled = !selected.size || !reviewValid; }
});
$('confirm').addEventListener('change', () => { $('rehearse').disabled = !$('confirm').checked || !plan; });
$('rehearse').addEventListener('click', async () => {
  if (!plan || !$('confirm').checked) return;
  $('rehearse').disabled = true; $('error').hidden = true; $('progress').textContent = '저장본을 다시 확인하고 사본에 반영하는 중입니다.';
  try {
    const result = await api('/api/rehearse', { planId: plan.id, digest: plan.digest });
    $('progress').textContent = `사본 자료 ${result.files}개 준비 완료`;
    $('result-preview').href = result.preview; $('package').href = result.package; $('result').hidden = false;
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { showError(error); $('progress').textContent = '반영 시험을 완료하지 못했습니다. 기존 자료는 유지됩니다.'; }
  finally { $('rehearse').disabled = !plan || !$('confirm').checked; }
});
load();
