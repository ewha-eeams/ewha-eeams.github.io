const exactKeys = (value, expected) => value && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...expected].sort().join(',');

const isoTime = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function validBusyResponse(data) {
  if (!exactKeys(data, ['ok', 'schema', 'mode', 'timeZone', 'range', 'busy'])
    || data.ok !== true || data.schema !== 1 || data.mode !== 'test-read-only'
    || data.timeZone !== 'Asia/Seoul' || !Array.isArray(data.busy) || data.busy.length > 1000) return false;
  const interval = value => exactKeys(value, ['start', 'end'])
    && isoTime(value.start) && isoTime(value.end) && value.end > value.start;
  return interval(data.range) && data.busy.every(item => interval(item)
    && item.start >= data.range.start && item.end <= data.range.end);
}

// FullCalendar uses UTC as a civil-time display; convert instants to Seoul first.
export function seoulCivilTime(iso) {
  if (!isoTime(iso)) throw new Error('INVALID_TIME');
  return new Date(Date.parse(iso) + 9 * 60 * 60 * 1000).toISOString().slice(0, -1);
}

export function busyCalendarData(data) {
  if (!validBusyResponse(data)) throw new Error('INVALID_RESPONSE');
  return {
    range: { start: seoulCivilTime(data.range.start), end: seoulCivilTime(data.range.end) },
    events: data.busy.map((item, index) => ({
      id: `busy-${index}`, title: '예약 시간',
      start: seoulCivilTime(item.start), end: seoulCivilTime(item.end),
    })),
  };
}
