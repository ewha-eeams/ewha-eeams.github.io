import { readSnapshot } from './preview-model.mjs';
export const snapshot = readSnapshot(new URLSearchParams(location.search).get('snapshot'));
const entryFor = concert => snapshot.entries.find(e => e.recordId === `${concert.year}-${concert.slug}`);

export function savedMediaPath(concert, suffix) {
  const entry = entryFor(concert);
  if (!entry) return '';
  return suffix === 'poster.jpg' ? entry.poster : suffix === 'program-book.pdf' ? entry.pdf : suffix === 'photo1.jpg' ? entry.photos[0] || '' : '';
}
function viewerUrl(entry, kind, label) {
  if (!entry) return '';
  const url = new URL('media.html', import.meta.url);
  url.search = new URLSearchParams({ snapshot: snapshot.commit, record: entry.recordId, kind, label });
  return url.href;
}
export function savedMediaUrl(src, label, recordId) {
  const entry = snapshot.entries.find(e => e.recordId === recordId);
  return viewerUrl(entry, src === entry?.pdf ? 'pdf' : 'poster', label);
}
export function savedGalleryUrl(concert) { return viewerUrl(entryFor(concert), 'photos', `${concert.title} · 사진`); }
export function hasSavedPhotos(concert) { return Boolean(entryFor(concert)?.photos.length); }
export async function previewFetch(path, options) {
  const resource = snapshot.resources[String(path)];
  // The pinned repository tree is the existence check. Never fall back to public media.
  return new Response(null, { status: options?.method === 'HEAD' && resource ? 200 : 404, headers: resource ? { 'Content-Type': resource.mime } : {} });
}
