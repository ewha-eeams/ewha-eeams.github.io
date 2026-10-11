import { busyCalendarData, busyWeekSummary, mondayOfWeek } from './studio-readonly.mjs?v=5';
import { seoulDate } from './studio-model.mjs';
import { swipeDirection } from './studio-swipe.mjs';

// Public, test-only read endpoint. No credentials or personal Calendar ID.
const endpoint = 'https://script.google.com/macros/s/AKfycbxg4htE_XDuE-XHl1l4QykqGWKjFvqNFbK_7E_5aIaOpPt4dkJT5CNbTHWpHQq-1Ogl/exec';
const get = id => document.getElementById(`studio-${id}`);
const mobile = matchMedia('(max-width: 680px)');
let calendar;
const qrEntry = new URLSearchParams(location.search).get('studio') === 'today';
let period = mobile.matches || qrEntry ? 'day' : 'week';
let loading = false;
let selectedDate;
let preservedScroll = null;
let lastAttempt = 0;
const civilNow = () => new Date(Date.now() + 9 * 3600000);
function calendarHeight() {
  if (mobile.matches && period !== 'month') {
    const header = document.querySelector('.site-header')?.getBoundingClientRect().height || 64;
    const toolbar = document.querySelector('.studio-toolbar')?.getBoundingClientRect().height || 90;
    const available = (window.visualViewport?.height || innerHeight) - header - toolbar - 40;
    return Math.max(200, Math.min(560, Math.floor(available)));
  }
  return !mobile.matches && period === 'month' ? 600 : 'auto';
}
function updateViewport() {
  const header = document.querySelector('.site-header')?.getBoundingClientRect().height || 64;
  document.querySelector('.studio-toolbar')?.style.setProperty('scroll-margin-top', `${header + 12}px`);
  if (!calendar) return;
  const height = calendarHeight();
  if (calendar.getOption('height') === height) return;
  const scroller = get('calendar').querySelector('.fc-scroller-liquid-absolute');
  const scroll = scroller?.scrollTop;
  calendar.setOption('height', height);
  if (scroll !== undefined) requestAnimationFrame(() => {
    const current = get('calendar').querySelector('.fc-scroller-liquid-absolute');
    if (current) current.scrollTop = scroll;
  });
}
function alignCurrentTime() {
  if (!calendar) return;
  if (preservedScroll !== null) {
    const scroller = get('calendar').querySelector('.fc-scroller-liquid-absolute');
    if (scroller) scroller.scrollTop = preservedScroll;
    preservedScroll = null;
    return;
  }
  if (period !== 'day') return;
  const today = calendar.view.activeStart.toISOString().slice(0, 10) <= seoulDate()
    && calendar.view.activeEnd.toISOString().slice(0, 10) > seoulDate();
  const now = civilNow();
  const minutes = today ? now.getUTCHours() * 60 + now.getUTCMinutes() - 90 : 480;
  calendar.scrollToTime({ minutes: Math.max(480, Math.min(1230, minutes)) });
}
function updateClock() {
  const now = civilNow();
  const date = now.toISOString().slice(0, 10);
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  document.querySelectorAll('.studio-mini-now').forEach(line => {
    line.hidden = line.dataset.date !== date || minutes < 480 || minutes >= 1320;
    line.style.top = `${(minutes - 480) / 840 * 100}%`;
  });
  calendar?.setOption('now', now);
}

function view() {
  if (period === 'day') return mobile.matches ? 'timeGridThreeDay' : 'timeGridDay';
  return period === 'month' ? 'dayGridMonth' : 'timeGridWeek';
}
function showTime(event) {
  get('dialog-title').textContent = '예약 시간';
  get('dialog-info').textContent = `${event.startStr.slice(0, 16).replace('T', ' ')} ~ ${event.endStr.slice(0, 16).replace('T', ' ')} (한국 시간)`;
  get('dialog-note').textContent = '예약된 시간입니다. 현재 재실 여부를 나타내지는 않습니다.';
  get('cancel').hidden = true;
  get('dialog').showModal();
}
function controls(disabled) {
  for (const id of ['prev', 'next', 'today', 'day', 'week', 'month', 'reload']) get(id).disabled = disabled;
}
async function load(options = {}) {
  const silent = options.silent === true && !!calendar;
  if (loading) return;
  loading = true;
  lastAttempt = Date.now();
  if (!silent) controls(true);
  get('retry').disabled = true;
  if (!silent) {
    get('dialog').close();
    if (calendar) selectedDate = calendar.getDate().toISOString().slice(0, 10);
    calendar?.destroy();
    calendar = null;
    get('calendar').hidden = true;
    get('error').hidden = true;
    get('range').textContent = '';
    get('access-state').textContent = '일정을 확인하고 있습니다.';
    get('summary-status').textContent = '일정을 불러오고 있습니다.';
    get('summary-week').replaceChildren();
    get('summary-week').hidden = true;
  }
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetch(endpoint, { credentials: 'omit', mode: 'cors', cache: 'no-store', signal: abort.signal });
    if (!response.ok) throw new Error('HTTP');
    const display = busyCalendarData(await response.json());
    if (!window.FullCalendar) throw new Error('CALENDAR');
    // Never replace a calendar or mini-calendar while it has keyboard focus.
    if (silent && (get('dialog').open || get('calendar').contains(document.activeElement) || get('summary-week').contains(document.activeElement))) return;
    if (silent) {
      selectedDate = calendar.getDate().toISOString().slice(0, 10);
      preservedScroll = get('calendar').querySelector('.fc-scroller-liquid-absolute')?.scrollTop ?? null;
      calendar.destroy();
    }
    get('summary-week').replaceChildren();
    get('error').hidden = true;
    const today = seoulDate();
    controls(false);
    get('calendar').hidden = false;
    calendar = new FullCalendar.Calendar(get('calendar'), {
      initialDate: selectedDate || today, initialView: view(), timeZone: 'UTC', locale: 'ko', firstDay: 1,
      dayHeaderFormat: mobile.matches ? { day: 'numeric', weekday: 'short' } : { month: 'numeric', day: 'numeric', weekday: 'short' },
      dayHeaderContent(info) {
        if (!mobile.matches || info.view.type !== 'timeGridWeek') return info.text;
        const label = document.createElement('span');
        label.className = 'studio-week-heading';
        for (const text of [String(info.date.getUTCDate()), ['일', '월', '화', '수', '목', '금', '토'][info.date.getUTCDay()]]) {
          const line = document.createElement('span');
          line.textContent = text;
          label.append(line);
        }
        return { domNodes: [label] };
      },
      now: civilNow(), nowIndicator: true,
      views: { timeGridThreeDay: { type: 'timeGrid', duration: { days: 3 }, dateIncrement: { days: 1 }, dateAlignment: 'day', dayHeaderFormat: { month: 'numeric', day: 'numeric', weekday: 'short' } } },
      headerToolbar: false, height: calendarHeight(), scrollTime: '08:00:00',
      validRange: display.range, events: display.events,
      eventColor: '#3278c2', slotMinTime: '08:00:00', slotMaxTime: '22:00:00',
      slotDuration: '01:00:00', allDaySlot: false, slotEventOverlap: false, dayMaxEvents: 3,
      noEventsContent: '조회 범위 내 테스트 일정이 없습니다.',
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      datesSet(info) {
        get('range').textContent = info.view.title;
        get('day').setAttribute('aria-pressed', String(period === 'day'));
        get('week').setAttribute('aria-pressed', String(period === 'week'));
        get('month').setAttribute('aria-pressed', String(period === 'month'));
        get('prev').disabled = info.startStr.slice(0, 10) <= display.range.start.slice(0, 10);
        get('next').disabled = info.endStr.slice(0, 10) >= display.range.end.slice(0, 10);
        requestAnimationFrame(alignCurrentTime);
      },
      eventClick(info) { showTime(info.event); },
      dayCellDidMount(info) {
        if (info.view.type !== 'dayGridMonth' || info.isDisabled) return;
        const date = info.date.toISOString().slice(0, 10);
        const next = new Date(info.date.getTime() + 86400000).toISOString().slice(0, 10);
        const count = display.events.filter(event => event.start < `${next}T00:00:00.000` && event.end > `${date}T00:00:00.000`).length;
        if (!count) return;
        const badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'studio-month-count';
        badge.textContent = `${count}건`;
        badge.setAttribute('aria-label', `${date} 예약 ${count}건, 상세 일정 보기`);
        badge.addEventListener('click', event => {
          event.stopPropagation();
          selectedDate = date;
          period = 'day';
          changeView();
          calendar.gotoDate(date);
        });
        info.el.querySelector('.fc-daygrid-day-frame').append(badge);
      },
      dateClick(info) {
        if (period !== 'month') return;
        selectedDate = info.dateStr.slice(0, 10);
        period = 'day';
        changeView();
        calendar.gotoDate(selectedDate);
      },
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
    get('access-state').textContent = '';
    const days = busyWeekSummary(display, mondayOfWeek(today));
    const axis = document.createElement('li');
    axis.className = 'studio-mini-axis';
    axis.setAttribute('aria-hidden', 'true');
    for (const hour of [8, 12, 16, 20, 22]) {
      const tick = document.createElement('span');
      tick.textContent = String(hour).padStart(2, '0');
      tick.style.top = `${(hour - 8) / 14 * 100}%`;
      axis.append(tick);
    }
    get('summary-week').append(axis);
    for (const [index, day] of days.entries()) {
      const item = document.createElement('li');
      item.classList.toggle('is-today', day.date === today);
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
      for (const text of [day.date === today ? '오늘' : day.weekday, `${Number(day.date.slice(5,7))}/${Number(day.date.slice(8))}`]) {
        const span = document.createElement('span'); span.textContent = text; link.append(span);
      }
      const track = document.createElement('span');
      track.className = 'studio-mini-track';
      track.classList.toggle('is-unavailable', day.count === null);
      track.setAttribute('aria-hidden', 'true');
      if (day.count === null) track.textContent = '—';
      for (const block of day.blocks) {
        const mark = document.createElement('span');
        mark.className = 'studio-mini-booking';
        mark.style.top = `${block.top}%`;
        mark.style.height = `${block.height}%`;
        mark.style.left = `calc(${block.column / block.columns * 100}% + 1px)`;
        mark.style.width = `calc(${100 / block.columns}% - 2px)`;
        mark.title = `${block.start}–${block.end}`;
        const label = document.createElement('span');
        label.className = 'studio-mini-time';
        label.textContent = `${block.start}–${block.end}`;
        mark.append(label);
        track.append(mark);
      }
      const line = document.createElement('span');
      line.className = 'studio-mini-now';
      line.dataset.date = day.date;
      track.append(line);
      link.append(track);
      item.append(link);
      get('summary-week').append(item);
    }
    get('summary-week').hidden = false;
    updateClock();
    get('summary-status').textContent = days.some(day => day.count === null) ? '— 표시 날짜는 조회되지 않았습니다.' : '';
    if (qrEntry && !selectedDate) requestAnimationFrame(() => {
      updateViewport();
      document.querySelector('.studio-toolbar').scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  } catch {
    if (silent && calendar) {
      get('access-state').textContent = '최신 일정을 확인하지 못했습니다. 이전 조회 결과입니다. 새로고침해 주세요.';
      get('summary-status').textContent = '최신 일정 확인 실패 · 이전 조회 결과';
      return;
    }
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
  calendar.setOption('height', calendarHeight());
  calendar.changeView(view());
  get('day').setAttribute('aria-pressed', String(period === 'day'));
  get('week').setAttribute('aria-pressed', String(period === 'week'));
  get('month').setAttribute('aria-pressed', String(period === 'month'));
}
get('day').onclick = () => { period = 'day'; changeView(); };
get('week').onclick = () => { period = 'week'; changeView(); };
get('month').onclick = () => { period = 'month'; changeView(); };
let dateAnimations = [];
function animateDate(direction) {
  dateAnimations.forEach(animation => animation.cancel());
  dateAnimations = [];
  if (!mobile.matches || period !== 'day' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // Move date columns only; the time ruler and vertical scroll stay in place.
  for (const node of document.querySelectorAll('#studio-calendar .fc-timegrid-cols, #studio-calendar .fc-col-header-cell-cushion')) {
    if (!node.animate) continue;
    dateAnimations.push(node.animate([
      { transform: `translateX(${direction * 18}px)`, opacity: 0.65 },
      { transform: 'translateX(0)', opacity: 1 },
    ], { duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }));
  }
}
function moveDate(direction) {
  if (!calendar || loading || get(direction < 0 ? 'prev' : 'next').disabled) return;
  if (mobile.matches && period === 'day') preservedScroll = get('calendar').querySelector('.fc-scroller-liquid-absolute')?.scrollTop ?? null;
  if (direction < 0) calendar.prev(); else calendar.next();
  animateDate(direction);
}
get('prev').onclick = () => moveDate(-1);
get('next').onclick = () => moveDate(1);
get('today').onclick = () => {
  preservedScroll = null;
  calendar?.gotoDate(seoulDate()); requestAnimationFrame(alignCurrentTime);
};
let gesture = null, suppressClickUntil = 0;
const surface = get('calendar');
surface.addEventListener('pointerdown', event => {
  if (!event.isPrimary) { gesture = null; return; }
  gesture = mobile.matches && period === 'day' && event.pointerType === 'touch'
    ? { x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId } : null;
}, { passive: true });
surface.addEventListener('pointercancel', () => { gesture = null; }, { passive: true });
surface.addEventListener('pointerup', event => {
  if (!gesture || gesture.id !== event.pointerId) return;
  const direction = swipeDirection(gesture, { x: event.clientX, y: event.clientY, time: performance.now() }, innerWidth);
  gesture = null;
  if (direction) { suppressClickUntil = performance.now() + 400; moveDate(direction); }
}, { passive: true });
surface.addEventListener('click', event => {
  if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true);
get('reload').onclick = load;
get('retry').onclick = load;
get('dialog-close').onclick = () => get('dialog').close();
mobile.addEventListener('change', changeView);
let viewportTimer;
function scheduleViewport() {
  clearTimeout(viewportTimer);
  viewportTimer = setTimeout(updateViewport, 120);
}
window.addEventListener('resize', scheduleViewport);
window.visualViewport?.addEventListener('resize', scheduleViewport);
const layoutObserver = new ResizeObserver(scheduleViewport);
for (const selector of ['.site-header', '.studio-toolbar']) {
  const node = document.querySelector(selector);
  if (node) layoutObserver.observe(node);
}
updateViewport();
setInterval(updateClock, 60000);
function refreshVisible() {
  if (document.hidden || Date.now() - lastAttempt < 60000 || get('dialog').open) return;
  const visible = ['calendar', 'summary-week'].some(id => {
    const node = get(id), rect = node.getBoundingClientRect();
    return !node.hidden && rect.bottom > 0 && rect.top < innerHeight;
  });
  if (visible) load({ silent: true });
}
setInterval(refreshVisible, 60000);
document.addEventListener('visibilitychange', () => { updateClock(); refreshVisible(); });
load();
