import { compileSnapshot } from './preview-model.mjs';
import { groupRows, rowsFor, mergeConcert, serializeCsv, concertFields, workFields } from './concert-model.mjs';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const labels = { title: '공연명', title_en: '공연명 · 영문', venue: '장소', venue_en: '장소 · 영문' };
const pick = (object, keys) => Object.fromEntries(keys.map(k => [k, object[k] || '']));
const workValues = concert => concert.works.map(w => pick(w, workFields));
const mediaPrefix = id => `assets/media/concerts/${id.slice(0, 4)}/${id}-`;
export const allowedPublishPath = path => path === 'data/archive.csv' || /^assets\/media\/concerts\/([0-9]{4})\/\1-concert[1-9][0-9]*-(?:poster\.jpg|program-book\.pdf|photo(?:[1-9]|1[0-9]|20)\.jpg)$/.test(path);

function publicMedia(id, blobs) {
  const prefix = mediaPrefix(id);
  const value = suffix => blobs.get(prefix + suffix) || null;
  const photos = [];
  let gap = false;
  for (let n = 1; n <= 20; n++) {
    const photo = value(`photo${n}.jpg`);
    if (!photo) gap = true;
    else { if (gap) throw new Error(`${id}: 공개 사진 번호가 이어지지 않습니다. 자료를 먼저 확인해 주세요.`); photos.push(photo); }
  }
  return { poster: value('poster.jpg'), pdf: value('program-book.pdf'), photos };
}
const mediaHashes = media => ({ poster: media.poster?.sha || '', pdf: media.pdf?.sha || '', photos: media.photos.map(p => p.sha) });

export function buildReview({ source, files, baseTree, draftTree, baseCommit, draftCommit, baseCsv }) {
  const snapshot = compileSnapshot({ source, files, tree: draftTree, commit: draftCommit });
  if (snapshot.warnings.length) throw new Error(snapshot.warnings.join('\n'));
  const baseBlobs = new Map(baseTree.filter(b => b.type === 'blob').map(b => [b.path, b]));
  const draftBlobs = new Map(draftTree.filter(b => b.type === 'blob').map(b => [b.path, b]));
  const originals = new Map(groupRows(source.rows).map(c => [c.id, c]));
  const entries = snapshot.entries.map(entry => {
    const file = files.find(f => f.path === entry.path), old = entry.existing ? originals.get(file.data.origin_id) : null;
    const concert = { ...pick(file.data, concertFields), works: file.data.works.map(w => pick(w, workFields)) };
    const beforeMedia = old ? publicMedia(old.id, baseBlobs) : { poster: null, pdf: null, photos: [] };
    const ref = url => url ? draftBlobs.get(snapshot.resources[url].path) : null;
    const afterMedia = { poster: ref(entry.poster), pdf: ref(entry.pdf), photos: entry.photos.map(ref) };
    const changes = Object.entries(labels).filter(([key]) => (old?.[key] || '') !== concert[key]).map(([key, label]) => ({ key, label, before: old?.[key] || '', after: concert[key] }));
    const worksChanged = !old || !equal(workValues(old), concert.works);
    const mediaChanges = ['poster', 'pdf', 'photos'].filter(key => !equal(mediaHashes(beforeMedia)[key], mediaHashes(afterMedia)[key]));
    return { ...entry, concert, old, beforeMedia, afterMedia, changes, worksChanged, beforeWorks: old ? workValues(old) : [], afterWorks: concert.works,
      mediaChanges, status: !old ? 'new' : changes.length || worksChanged || mediaChanges.length ? 'edited' : 'unchanged' };
  });
  return { source, baseCsv, baseCommit, draftCommit, baseTree, draftTree, entries };
}

export function publicReview(review) {
  return { baseCommit: review.baseCommit, draftCommit: review.draftCommit, entries: review.entries.map(({ concert, old, ...entry }) => ({ ...entry })) };
}

export function preparePlan(review, selectedIds) {
  if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.length > 200 || new Set(selectedIds).size !== selectedIds.length) throw new Error('확인할 공연을 선택해 주세요.');
  const selected = selectedIds.map(id => review.entries.find(e => e.cms_id === id));
  if (selected.some(e => !e || e.status === 'unchanged')) throw new Error('변경된 공연만 반영 준비에 포함할 수 있습니다.');
  selected.sort((a, b) => a.path.localeCompare(b.path));
  const taken = new Set(groupRows(review.source.rows).map(c => c.id));
  const paths = new Set(review.baseTree.map(b => b.path));
  const mapping = [], operations = [];
  let rows = structuredClone(review.source.rows);
  for (const entry of selected) {
    let id = entry.old?.id;
    const concert = structuredClone(entry.concert);
    if (!id) {
      const year = concert.date.slice(0, 4);
      let n = Math.max(0, ...[...taken].filter(x => x.startsWith(`${year}-concert`)).map(x => Number(x.split('concert')[1])));
      do { n++; id = `${year}-concert${n}`; } while (taken.has(id) || [...paths].some(p => p.startsWith(mediaPrefix(id))));
      taken.add(id); concert.slug = `concert${n}`; concert.original = false;
    } else { concert.id = id; concert.original = true; }
    rows = mergeConcert(rows, concert);
    mapping.push({ cms_id: entry.cms_id, publicId: id, title: entry.title, existing: entry.existing });
    const desired = new Map();
    if (entry.afterMedia.poster) desired.set(mediaPrefix(id) + 'poster.jpg', entry.afterMedia.poster);
    if (entry.afterMedia.pdf) desired.set(mediaPrefix(id) + 'program-book.pdf', entry.afterMedia.pdf);
    entry.afterMedia.photos.forEach((photo, i) => desired.set(mediaPrefix(id) + `photo${i + 1}.jpg`, photo));
    const previous = [entry.beforeMedia.poster, entry.beforeMedia.pdf, ...entry.beforeMedia.photos].filter(Boolean);
    for (const [path, source] of desired) {
      const before = previous.find(p => p.path === path);
      if (before?.sha !== source.sha) operations.push({ action: before ? 'replace' : 'add', path, sourcePath: source.path, sourceCommit: review.draftCommit, sha: source.sha, size: source.size });
    }
    for (const before of previous) if (!desired.has(before.path)) operations.push({ action: 'delete', path: before.path, beforeSha: before.sha });
  }
  const csvChanged = !equal(rows, review.source.rows);
  const csv = csvChanged ? serializeCsv(rows) : review.baseCsv;
  if (csvChanged) operations.unshift({ action: 'replace', path: 'data/archive.csv', kind: 'csv' });
  if (!operations.length || operations.some(op => !allowedPublishPath(op.path))) throw new Error('허용되지 않은 반영 범위입니다.');
  if (operations.reduce((sum, op) => sum + (op.size || 0), new TextEncoder().encode(csv).length) > 80 * 1024 * 1024) throw new Error('한 번에 준비할 자료는 합계 80 MB 이내로 선택해 주세요.');
  return { schema: 1, trialOnly: true, published: false, baseCommit: review.baseCommit, draftCommit: review.draftCommit, selectedIds: selected.map(e => e.cms_id), mapping, operations, csv, csvChanged, rows };
}

export function assertCurrent(plan, refs) {
  if (plan.baseCommit !== refs.baseCommit || plan.draftCommit !== refs.draftCommit) {
    const error = new Error('CMS 또는 공개 홈페이지 저장본이 달라졌습니다. 변경 내용을 다시 불러와 확인해 주세요.'); error.code = 'STALE_REVIEW'; throw error;
  }
}
