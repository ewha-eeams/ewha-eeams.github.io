export const headers = ['date', 'slug', 'title', 'title_en', 'venue', 'venue_en', 'composer', 'composer_en', 'work_order', 'work_title', 'work_title_en', 'format', 'media_url'];
export const concertFields = ['date', 'slug', 'title', 'title_en', 'venue', 'venue_en'];
export const workFields = headers.filter(key => !concertFields.includes(key) && key !== 'work_order');
export const concertId = row => `${row.date.slice(0, 4)}-${row.slug}`;

export function groupRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const id = concertId(row);
    if (!groups.has(id)) groups.set(id, { id, original: true, ...Object.fromEntries(concertFields.map(key => [key, row[key]])), works: [] });
    groups.get(id).works.push({ ...row });
  }
  for (const concert of groups.values()) concert.works.sort((a, b) => Number(a.work_order) - Number(b.work_order));
  return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function rowsFor(concert) {
  return concert.works.map((work, index) => Object.fromEntries(headers.map(key => [key,
    key === 'work_order' ? String(index + 1) : concertFields.includes(key) ? concert[key] || '' : work[key] || '',
  ])));
}

export function validateConcert(concert, source) {
  const errors = [];
  const date = concert.date || '';
  const validFormat = /^\d{4}(?:-\d{2}-\d{2})?$/.test(date);
  const parsed = date.length === 10 ? new Date(`${date}T00:00:00Z`) : null;
  if (!validFormat || (parsed && (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date))) errors.push('날짜는 YYYY 또는 YYYY-MM-DD 형식으로 입력해 주세요.');
  if (!/^concert[1-9]\d*$/.test(concert.slug || '')) errors.push('공연 식별자를 확인해 주세요.');
  if (!(concert.title || concert.title_en || '').trim()) errors.push('공연명을 입력해 주세요.');
  if (!(concert.venue || concert.venue_en || '').trim()) errors.push('장소를 입력해 주세요.');
  if (!concert.works.length) errors.push('작품을 한 곡 이상 추가해 주세요.');
  if (concert.original && `${date.slice(0, 4)}-${concert.slug}` !== concert.id) errors.push('기존 공연의 연도와 식별자는 유지해야 합니다.');
  if (!concert.original && source.some(row => concertId(row) === concertId(concert))) errors.push('같은 연도에 이미 사용 중인 공연 식별자입니다.');
  concert.works.forEach((work, index) => {
    if (!(work.composer || work.composer_en || '').trim()) errors.push(`${index + 1}번 작품의 작곡가를 입력해 주세요.`);
    if (!(work.work_title || work.work_title_en || '').trim()) errors.push(`${index + 1}번 작품의 작품명을 입력해 주세요.`);
    if (work.media_url) {
      try { if (!['https:', 'http:'].includes(new URL(work.media_url).protocol)) throw Error(); }
      catch { errors.push(`${index + 1}번 작품의 미디어 주소는 http 또는 https 주소로 입력해 주세요.`); }
    }
  });
  return errors;
}

export function mergeConcert(source, concert) {
  const errors = validateConcert(concert, source);
  if (errors.length) throw new Error(errors.join('\n'));
  const replacement = rowsFor(concert);
  if (!concert.original) return [...source.map(row => ({ ...row })), ...replacement];
  let inserted = false;
  const rows = [];
  for (const row of source) {
    if (concertId(row) === concert.id) {
      if (!inserted) rows.push(...replacement);
      inserted = true;
    } else rows.push({ ...row });
  }
  if (!inserted) throw new Error('원본 공연을 찾을 수 없습니다.');
  return rows;
}

export function serializeCsv(rows) {
  const cell = value => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value);
  return '\uFEFF' + [headers, ...rows.map(row => headers.map(key => row[key] ?? ''))].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
