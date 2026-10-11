import { busyCalendarData, busyWeekSummary } from './studio-readonly.mjs?v=2';
import { seoulDate } from './studio-model.mjs';

// Public, test-only read endpoint. No credentials or personal Calendar ID.
const endpoint = 'https://script.google.com/macros/s/AKfycbxg4htE_XDuE-XHl1l4QykqGWKjFvqNFbK_7E_5aIaOpPt4dkJT5CNbTHWpHQq-1Ogl/exec';
const get = id => document.getElementById(`studio-${id}`);
const mobile = matchMedia('(max-width: 680px)');
let calendar;
let period = 'week';
let loading = false;
let selectedDate;

function view() {
  if (period === 'day') return mobile.matches ? 'listDay' : 'timeGridDay';
  return period === 'month' ? 'dayGridMonth' : mobile.matches ? 'listWeek' : 'timeGridWeek';
}
function showTime(event) {
  get('dialog-title').textContent = '테스트 예약 시간';
  get('dialog-info').textContent = `${event.startStr.slice(0, 16).replace('T', ' ')} ~ ${event.endStr.slice(0, 16).replace('T', ' ')} (한국 시간)`;
  get('dialog-note').textContent = '연결 확인용 일정입니다. 실제 예약이나 재실 여부를 나타내지 않습니다.';
  get('cancel').hidden = true;
  get('dialog').showModal();
}
function controls(disabled) {
  for (const id of ['prev', 'next', 'today', 'week', 'month', 'reload']) get(id).disabled = disabled;
}
async function load() {
  if (loading) return;
  loading = true;
  controls(true);
  get('retry').disabled = true;
  get('dialog').close();
  if (calendar) selectedDate = calendar.getDate().toISOString().slice(0, 10);
  calendar?.destroy();
  calendar = null;
  get('calendar').hidden = true;
  get('error').hidden = true;
  get('range').textContent = '';
  get('access-state').textContent = '테스트 일정을 확인하고 있습니다.';
  get('summary-status').textContent = '일정을 불러오고 있습니다.';
  get('summary-week').replaceChildren();
  get('summary-week').hidden = true;
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetch(endpoint, { credentials: 'omit', mode: 'cors', cache: 'no-store', signal: abort.signal });
    if (!response.ok) throw new Error('HTTP');
    const display = busyCalendarData(await response.json());
    if (!window.FullCalendar) throw new Error('CALENDAR');
    const today = seoulDate();
    controls(false);
    get('calendar').hidden = false;
    calendar = new FullCalendar.Calendar(get('calendar'), {
      initialDate: selectedDate || display.range.start, initialView: view(), timeZone: 'UTC', locale: 'ko', firstDay: 1,
      headerToolbar: false, height: !mobile.matches && period === 'month' ? 600 : 'auto',
      validRange: display.range, events: display.events,
      eventColor: '#286753', slotMinTime: '08:00:00', slotMaxTime: '22:00:00',
      slotDuration: '01:00:00', allDaySlot: false, slotEventOverlap: false, dayMaxEvents: 3,
      noEventsContent: '조회 범위 내 테스트 일정이 없습니다.',
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      datesSet(info) {
        get('range').textContent = info.view.title;
        get('week').setAttribute('aria-pressed', String(period === 'week'));
        get('month').setAttribute('aria-pressed', String(period === 'month'));
        get('prev').disabled = info.startStr.slice(0, 10) <= display.range.start.slice(0, 10);
        get('next').disabled = info.endStr.slice(0, 10) >= display.range.end.slice(0, 10);
      },
      eventClick(info) { showTime(info.event); },
      eventDidMount(info) {
        info.el.tabIndex = 0;
        info.el.setAttribute('role', 'button');
        info.el.setAttribute('aria-label', `${info.event.startStr.slice(0, 16).replace('T', ' ')} 테스트 예약 시간 보기`);
        info.el.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showTime(info.event); }
        });
      },
    });
    calendar.render();
    get('access-state').textContent = `한국 시간 · ${display.range.start.slice(0, 10)}부터 ${display.range.end.slice(0, 10)} 00:00 전까지 조회`;
    const days = busyWeekSummary(display, today);
    for (const [index, day] of days.entries()) {
      const item = document.createElement('li');
      item.classList.toggle('is-today', index === 0);
      const link = document.createElement(day.count === null ? 'span' : 'a');
      link.className = 'studio-day';
      link.setAttribute('aria-label', `${day.date} ${day.weekday}요일 ${day.count === null ? '미조회' : `예약 ${day.count}건, 일정 보기`}`);
      if (day.count !== null) {
        link.href = '#studio';
        link.addEventListener('click', () => {
          selectedDate = day.date;
          period = 'day';
          changeView();
          calendar.gotoDate(day.date);
          get('range').focus({ preventScroll: true });
        });
      }
      for (const text of [index === 0 ? '오늘' : day.weekday, `${Number(day.date.slice(5,7))}/${Number(day.date.slice(8))}`, day.count === null ? '—' : `${day.count}건`]) {
        const span = document.createElement('span'); span.textContent = text; link.append(span);
      }
      item.append(link);
      get('summary-week').append(item);
    }
    get('summary-week').hidden = false;
    const updated = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    get('summary-status').textContent = `한국 시간 ${updated} 갱신${days.some(day => day.count === null) ? ' · — 미조회' : ''}`;
    get('access-state').textContent += ` · ${updated} 갱신`;
  } catch {
    calendar?.destroy();
    calendar = null;
    get('calendar').hidden = true;
    get('error').hidden = false;
    get('access-state').textContent = '조회 실패 · 예약이 없는 상태가 아닙니다.';
    get('summary-week').replaceChildren();
    get('summary-week').hidden = true;
    get('summary-status').textContent = '일정을 불러오지 못했습니다.';
    controls(true);
    get('reload').disabled = false;
  } finally {
    clearTimeout(timeout);
    loading = false;
    get('retry').disabled = false;
  }
}
function changeView() {
  if (!calendar) return;
  calendar.setOption('height', !mobile.matches && period === 'month' ? 600 : 'auto');
  calendar.changeView(view());
  get('week').setAttribute('aria-pressed', String(period === 'week'));
  get('month').setAttribute('aria-pressed', String(period === 'month'));
}
get('week').onclick = () => { period = 'week'; changeView(); };
get('month').onclick = () => { period = 'month'; changeView(); };
get('prev').onclick = () => calendar?.prev();
get('next').onclick = () => calendar?.next();
get('today').onclick = () => calendar?.gotoDate(seoulDate());
get('reload').onclick = load;
get('retry').onclick = load;
get('dialog-close').onclick = () => get('dialog').close();
mobile.addEventListener('change', changeView);
load();
