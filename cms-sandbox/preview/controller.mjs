import { branch, repository, rawUrl, compileSnapshot, storageKey } from './preview-model.mjs';
const $ = id => document.getElementById(id);
const select = $('concert'), frame = $('site-preview');
let snapshot;

async function get(url) {
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'GitHub 읽기 한도에 도달했습니다. 잠시 후 다시 불러와 주세요.' : `저장된 초안을 불러오지 못했습니다. (${response.status})`);
  return response;
}

function showSelected() {
  const entry = snapshot.entries.find(e => e.recordId === select.value);
  if (!entry) return;
  const url = new URL('archive.html', import.meta.url);
  url.searchParams.set('snapshot', snapshot.commit);
  url.searchParams.set('record', entry.recordId);
  url.searchParams.set('view', document.body.classList.contains('mobile-preview') ? 'mobile' : 'desktop');
  frame.src = url.href; frame.hidden = false;
  $('edit').href = entry.editUrl; $('edit').hidden = false;
  $('standalone').href = url.href; $('standalone').hidden = false;
  history.replaceState(null, '', `?record=${encodeURIComponent(entry.recordId)}`);
}

async function refresh() {
  const selected = new URLSearchParams(location.search).get('record') || select.value;
  $('reload').disabled = true; select.disabled = true;
  $('errors').hidden = true; $('warnings').hidden = true; $('warnings').replaceChildren();
  frame.hidden = true; $('edit').hidden = true; $('standalone').hidden = true;
  $('status').textContent = 'CMS에 저장된 내용을 불러오는 중입니다.';
  try {
    let commit;
    if (document.body.dataset.previewSource === 'manager') {
      snapshot = await (await get('/api/saved-preview')).json();
      commit = snapshot.commit;
      if (snapshot.schema !== 1 || snapshot.delivery !== 'local-server' || !/^[0-9a-f]{40}$/.test(commit || '')) throw new Error('관리 화면의 저장된 초안을 확인해 주세요.');
    } else {
    const api = `https://api.github.com/repos/${repository}`;
    const ref = await (await get(`${api}/branches/${branch}`)).json();
    commit = ref.commit?.sha;
    if (!/^[0-9a-f]{40}$/.test(commit || '')) throw new Error('저장본을 확인하지 못했습니다.');
    const treeResponse = await (await get(`${api}/git/trees/${commit}?recursive=1`)).json();
    if (treeResponse.truncated || !Array.isArray(treeResponse.tree)) throw new Error('자료 목록 일부가 누락됐습니다. 다시 불러와 주세요.');
    const paths = treeResponse.tree.filter(f => f.type === 'blob' && /^cms-sandbox\/(?:forms|drafts)\/[^/]+\.json$/.test(f.path));
    if (paths.length > 200) throw new Error('공연 사본이 많아 이번 미리보기 범위를 넘었습니다.');
    const [source, ...files] = await Promise.all([
      get(new URL('source.json', import.meta.url)).then(r => r.json()),
      ...paths.map(async ({ path }) => ({ path, data: await (await get(rawUrl(commit, path))).json() })),
    ]);
    snapshot = compileSnapshot({ source, files, tree: treeResponse.tree, commit });
    }
    localStorage.setItem(storageKey(commit), JSON.stringify(snapshot));
    select.replaceChildren();
    for (const [label, existing] of [['기존 공연 사본', true], ['새 공연 초안', false]]) {
      const group = document.createElement('optgroup'); group.label = label;
      for (const entry of snapshot.entries.filter(e => e.existing === existing)) {
        const option = document.createElement('option'); option.value = entry.recordId; option.textContent = `${entry.date} · ${entry.title}`; group.append(option);
      }
      if (group.children.length) select.append(group);
    }
    if (snapshot.entries.some(e => e.recordId === selected)) select.value = selected;
    for (const message of snapshot.warnings) { const li = document.createElement('li'); li.textContent = message; $('warnings').append(li); }
    $('warnings').hidden = !snapshot.warnings.length;
    $('status').textContent = `저장된 공연 ${snapshot.entries.length}건 · 미리보기`;
    select.disabled = false; showSelected();
  } catch (error) {
    $('errors').textContent = error.name === 'TimeoutError' ? '연결이 지연되고 있습니다. 잠시 후 다시 불러와 주세요.' : error.message;
    $('errors').hidden = false; $('status').textContent = '최신 저장본을 확인하지 못했습니다.';
  } finally { $('reload').disabled = false; }
}

$('reload').addEventListener('click', refresh);
select.addEventListener('change', showSelected);
for (const mode of ['desktop', 'mobile']) $(mode).addEventListener('click', () => {
  document.body.classList.toggle('mobile-preview', mode === 'mobile');
  for (const key of ['desktop', 'mobile']) $(key).setAttribute('aria-pressed', String(key === mode));
  if (snapshot) showSelected();
});
refresh();
