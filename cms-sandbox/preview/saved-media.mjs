import { readSnapshot } from './preview-model.mjs';
const params = new URLSearchParams(location.search);
const frame = document.querySelector('#media-frame'), download = document.querySelector('#media-download');
const title = document.querySelector('#media-title'), back = document.querySelector('#media-back');
let blobUrl;
function showError(message) { const p = document.createElement('p'); p.className = 'meta'; p.textContent = message; frame.replaceChildren(p); download.hidden = true; }
try {
  const snapshot = readSnapshot(params.get('snapshot'));
  const entry = snapshot.entries.find(e => e.recordId === params.get('record'));
  const kind = params.get('kind');
  if (!entry || !['poster', 'pdf', 'photos'].includes(kind)) throw new Error('미리보기 자료를 찾을 수 없습니다.');
  const label = `${entry.title} · ${kind === 'pdf' ? '프로그램북' : kind === 'poster' ? '포스터' : '사진'}`;
  title.textContent = label; document.title = `${label} | EEAMS 미리보기`;
  document.querySelector('#media-section-label').textContent = 'CMS PREVIEW';
  const archive = new URL('archive.html', import.meta.url);
  archive.searchParams.set('snapshot', snapshot.commit); archive.searchParams.set('record', entry.recordId);
  back.href = archive.href; back.textContent = '← 공연 미리보기로 돌아가기';
  const paths = kind === 'photos' ? entry.photos : [entry[kind]];
  if (!paths.length || paths.some(p => !snapshot.resources[p])) throw new Error('선택한 첨부 자료가 없습니다.');
  if (kind === 'pdf') {
    showError('프로그램북을 불러오는 중입니다.');
    const response = await fetch(paths[0], { credentials: 'omit', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('프로그램북을 불러오지 못했습니다.');
    const blob = await response.blob();
    if (blob.size > 20 * 1024 * 1024 || await blob.slice(0, 5).text() !== '%PDF-') throw new Error('PDF 파일을 확인해 주세요.');
    blobUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    const pdf = document.createElement('iframe'); pdf.title = label; pdf.src = blobUrl; frame.replaceChildren(pdf);
    download.href = blobUrl; download.download = snapshot.resources[paths[0]].path.split('/').pop(); download.textContent = 'PDF 내려받기'; download.hidden = false;
  } else {
    const gallery = document.createElement('div'); gallery.className = kind === 'photos' ? 'media-gallery' : '';
    if (kind === 'photos') frame.classList.add('media-gallery-frame');
    for (const [index, path] of paths.entries()) {
      const figure = document.createElement('figure'); figure.className = 'media-gallery-item';
      const image = document.createElement('img'); image.src = path; image.alt = `${label}${kind === 'photos' ? ` ${index + 1}` : ''}`;
      image.addEventListener('error', () => showError('이미지를 불러오지 못했습니다. 연결을 확인해 주세요.'));
      figure.append(image);
      if (kind === 'photos') {
        const caption = document.createElement('figcaption'), number = document.createElement('span'), link = document.createElement('a');
        number.textContent = String(index + 1).padStart(2, '0'); link.href = path; link.textContent = '원본 보기 ↗'; link.target = '_blank'; link.rel = 'noopener noreferrer'; caption.append(number, link); figure.append(caption);
      }
      gallery.append(figure);
    }
    frame.replaceChildren(gallery);
    if (kind === 'poster') { download.href = paths[0]; download.target = '_blank'; download.rel = 'noopener noreferrer'; download.textContent = '원본 보기 ↗'; download.hidden = false; }
  }
} catch (error) { showError(error.message); }
window.addEventListener('pagehide', () => { if (blobUrl) URL.revokeObjectURL(blobUrl); });
const menu = document.querySelector('#site-menu'), toggle = document.querySelector('.menu-toggle');
toggle?.addEventListener('click', () => { toggle.setAttribute('aria-expanded', String(menu.classList.toggle('is-open'))); });
