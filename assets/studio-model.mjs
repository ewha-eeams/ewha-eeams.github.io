export function seoulDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function addDays(day, count) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function bookingLimit(day) {
  const date = new Date(`${day}T00:00:00Z`);
  const requestedDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 2);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(requestedDay, last));
  return date.toISOString().slice(0, 10);
}

export function validateBooking(value, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || Number.isNaN(Date.parse(value.date)) || new Date(`${value.date}T00:00:00Z`).toISOString().slice(0, 10) !== value.date) return '올바른 날짜를 입력하세요.';
  if (value.date < today || value.date > bookingLimit(today)) return '오늘부터 두 달 이내의 날짜를 선택하세요.';
  const validTime = time => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
  if (!validTime(value.start) || !validTime(value.end) || value.end <= value.start) return '종료 시각은 같은 날의 시작 시각보다 늦어야 합니다.';
  if (!value.name?.trim() || value.name.length > 40 || !value.purpose?.trim() || value.purpose.length > 120) return '이름과 사용 목적을 입력 범위에 맞게 작성하세요.';
  return '';
}
