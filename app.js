const STORAGE_CLIENT = "weekend-calendar.clientId";
const STORAGE_HIDDEN = "weekend-calendar.hiddenCalendars";
const STORAGE_TOKEN = "weekend-calendar.token";
const STORAGE_SESSION = "weekend-calendar.session";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

const DEMO_CALENDARS = [
  { id: "work", summary: "Work", backgroundColor: "#039be5", foregroundColor: "#fff" },
  { id: "family", summary: "Family", backgroundColor: "#8e24aa", foregroundColor: "#fff" },
  { id: "personal", summary: "Personal", backgroundColor: "#0b8043", foregroundColor: "#fff" },
  { id: "birthdays", summary: "Birthdays", backgroundColor: "#33b679", foregroundColor: "#fff" },
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKENDS_SHOWN = 10;

function upcomingFriday(from = new Date()) {
  const day = startOfDay(from);
  const dow = day.getDay();
  if (dow === 5) return day;
  if (dow === 6) return addDays(day, -1);
  if (dow === 0) return addDays(day, -2);
  return addDays(day, 5 - dow);
}

const state = {
  startFriday: upcomingFriday(),
  miniYear: upcomingFriday().getFullYear(),
  miniMonth: upcomingFriday().getMonth(),
  events: [],
  calendars: DEMO_CALENDARS.slice(),
  hidden: new Set(JSON.parse(localStorage.getItem(STORAGE_HIDDEN) || "[]")),
  token: null,
  tokenExpiresAt: 0,
  connected: false,
  tokenClient: null,
};

function pad(n) {
  return String(n).padStart(2, "0");
}

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return x;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatTime(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return m === 0 ? `${h}${ampm}` : `${h}:${pad(m)}${ampm}`;
}

function formatRange(event) {
  if (event.allDay) {
    const last = addDays(event.end, -1);
    if (isSameDay(event.start, last)) {
      return event.start.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
    }
    return `${event.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${last.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }
  const same = isSameDay(event.start, event.end) || event.end - event.start < 24 * 3600 * 1000;
  if (same) {
    return `${event.start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · ${formatTime(event.start)} – ${formatTime(event.end)}`;
  }
  return `${event.start.toLocaleString()} – ${event.end.toLocaleString()}`;
}

function textOn(bg) {
  const hex = (bg || "#039be5").replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (full.length < 6) return "#fff";
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const y = (r * 299 + g * 587 + b * 114) / 1000;
  return y >= 155 ? "#1f1f1f" : "#fff";
}

function getClientId() {
  return (
    localStorage.getItem(STORAGE_CLIENT) ||
    window.WEEKEND_CALENDAR_CLIENT_ID ||
    ""
  ).trim();
}

function weekendsFrom(startFriday) {
  const friday = startOfDay(startFriday);
  const weekends = [];
  for (let i = 0; i < WEEKENDS_SHOWN; i += 1) {
    const start = addDays(friday, i * 7);
    weekends.push({
      friday: start,
      days: [start, addDays(start, 1), addDays(start, 2)],
    });
  }
  return weekends;
}

function weekendsInView() {
  return weekendsFrom(state.startFriday);
}

function viewTitle(weekends) {
  const start = weekends[0].days[0];
  const end = weekends[weekends.length - 1].days[2];
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${MONTHS[start.getMonth()]} – ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
  }
  return `${MONTHS[start.getMonth()]} ${start.getFullYear()} – ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
}

function eventOverlapsDay(event, day) {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  return event.start < dayEnd && event.end > dayStart;
}

function isBarEvent(event) {
  if (event.allDay) return true;
  const startDay = startOfDay(event.start);
  const endExclusive = event.end.getHours() === 0 && event.end.getMinutes() === 0 && event.end.getSeconds() === 0
    ? startOfDay(event.end)
    : addDays(startOfDay(event.end), 1);
  return endExclusive.getTime() > addDays(startDay, 1).getTime();
}

function visibleEvents() {
  return state.events.filter((event) => !state.hidden.has(event.calendarId));
}

function layoutWeekend(days, events) {
  const overlapping = events.filter((event) => days.some((day) => eventOverlapsDay(event, day)));
  const bars = [];
  const timedByDay = [[], [], []];

  for (const event of overlapping) {
    if (isBarEvent(event)) {
      let startIdx = 0;
      while (startIdx < 3 && !eventOverlapsDay(event, days[startIdx])) startIdx += 1;
      let endIdx = 2;
      while (endIdx >= 0 && !eventOverlapsDay(event, days[endIdx])) endIdx -= 1;
      if (startIdx > endIdx) continue;
      const weekendStart = startOfDay(days[0]);
      const weekendEnd = addDays(days[2], 1);
      bars.push({
        event,
        startIdx,
        endIdx,
        span: endIdx - startIdx + 1,
        continuesLeft: event.start < weekendStart,
        continuesRight: event.end > weekendEnd,
      });
    } else {
      for (let i = 0; i < 3; i += 1) {
        if (eventOverlapsDay(event, days[i])) timedByDay[i].push(event);
      }
    }
  }

  bars.sort(
    (a, b) =>
      a.startIdx - b.startIdx ||
      b.span - a.span ||
      a.event.start - b.event.start ||
      a.event.title.localeCompare(b.event.title)
  );
  for (const list of timedByDay) {
    list.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
  }

  const lanes = [];
  for (const bar of bars) {
    let lane = 0;
    for (; lane < lanes.length; lane += 1) {
      const conflict = lanes[lane].some(
        (other) => !(bar.endIdx < other.startIdx || bar.startIdx > other.endIdx)
      );
      if (!conflict) break;
    }
    bar.lane = lane;
    if (!lanes[lane]) lanes[lane] = [];
    lanes[lane].push(bar);
  }

  return { bars, timedByDay, laneCount: lanes.length };
}

function demoEvents(startFriday) {
  const weekends = weekendsFrom(startFriday);
  const events = [];
  let id = 0;

  const push = (partial) => {
    events.push({
      id: `demo-${id++}`,
      htmlLink: null,
      ...partial,
    });
  };

  weekends.forEach((weekend, index) => {
    const [fri, sat, sun] = weekend.days;
    const mon = addDays(sun, 1);

    push({
      calendarId: "work",
      title: "Mavenlink Check",
      start: new Date(fri.getFullYear(), fri.getMonth(), fri.getDate(), 8, 30),
      end: new Date(fri.getFullYear(), fri.getMonth(), fri.getDate(), 9, 0),
      allDay: false,
      color: "#039be5",
    });
    push({
      calendarId: "work",
      title: "Internal standup",
      start: new Date(fri.getFullYear(), fri.getMonth(), fri.getDate(), 9, 30),
      end: new Date(fri.getFullYear(), fri.getMonth(), fri.getDate(), 10, 0),
      allDay: false,
      color: "#3f51b5",
    });
    push({
      calendarId: "work",
      title: "Daily Product Sync",
      start: new Date(fri.getFullYear(), fri.getMonth(), fri.getDate(), 12, 0),
      end: new Date(fri.getFullYear(), fri.getMonth(), fri.getDate(), 12, 25),
      allDay: false,
      color: "#039be5",
    });
    push({
      calendarId: "work",
      title: "1:1 with manager",
      start: new Date(fri.getFullYear(), fri.getMonth(), fri.getDate(), 13, 0),
      end: new Date(fri.getFullYear(), fri.getMonth(), fri.getDate(), 13, 30),
      allDay: false,
      color: "#3f51b5",
    });
    push({
      calendarId: "work",
      title: "Sprint review",
      start: new Date(fri.getFullYear(), fri.getMonth(), fri.getDate(), 15, 0),
      end: new Date(fri.getFullYear(), fri.getMonth(), fri.getDate(), 16, 0),
      allDay: false,
      color: "#039be5",
    });

    if (index === 0) {
      push({
        calendarId: "family",
        title: "Molly Debate?",
        start: startOfDay(fri),
        end: startOfDay(sun),
        allDay: true,
        color: "#33b679",
      });
    }

    if (index === 1) {
      push({
        calendarId: "personal",
        title: "Weekend away",
        start: startOfDay(fri),
        end: startOfDay(mon),
        allDay: true,
        color: "#d50000",
      });
      push({
        calendarId: "family",
        title: "Dinner with parents",
        start: new Date(sat.getFullYear(), sat.getMonth(), sat.getDate(), 18, 0),
        end: new Date(sat.getFullYear(), sat.getMonth(), sat.getDate(), 20, 0),
        allDay: false,
        color: "#8e24aa",
      });
    }

    if (index === 2) {
      push({
        calendarId: "family",
        title: "Family visit",
        start: startOfDay(sat),
        end: startOfDay(mon),
        allDay: true,
        color: "#8e24aa",
      });
    }

    if (index % 2 === 0) {
      push({
        calendarId: "personal",
        title: "Farmers market",
        start: new Date(sat.getFullYear(), sat.getMonth(), sat.getDate(), 10, 0),
        end: new Date(sat.getFullYear(), sat.getMonth(), sat.getDate(), 11, 30),
        allDay: false,
        color: "#f4511e",
      });
    }

    push({
      calendarId: "family",
      title: "Brunch",
      start: new Date(sun.getFullYear(), sun.getMonth(), sun.getDate(), 11, 0),
      end: new Date(sun.getFullYear(), sun.getMonth(), sun.getDate(), 12, 30),
      allDay: false,
      color: "#8e24aa",
    });

    if (index === weekends.length - 1) {
      push({
        calendarId: "birthdays",
        title: "Sam's birthday",
        start: startOfDay(sat),
        end: addDays(sat, 1),
        allDay: true,
        color: "#33b679",
      });
    }
  });

  return events;
}

function calendarColor(calendarId, fallback) {
  const cal = state.calendars.find((item) => item.id === calendarId);
  return fallback || cal?.backgroundColor || "#039be5";
}

function viewRange() {
  const weekends = weekendsInView();
  return {
    startKey: dateKey(weekends[0].days[0]),
    endKey: dateKey(weekends[weekends.length - 1].days[2]),
  };
}

function miniMonthHtml(year, month, range, today, showNav) {
  const firstDow = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((firstDow + lastDate) / 7) * 7;
  let days = "";
  for (let i = 0; i < cellCount; i += 1) {
    const d = new Date(year, month, i - firstDow + 1);
    const key = dateKey(d);
    const classes = ["mini-day"];
    if (d.getMonth() !== month) classes.push("outside");
    if (key >= range.startKey && key <= range.endKey) classes.push("in-range");
    if (isSameDay(d, today)) classes.push("today");
    days += `<button class="${classes.join(" ")}" data-date="${key}">${d.getDate()}</button>`;
  }

  const nav = showNav
    ? `<button class="icon-btn" id="mini-prev" aria-label="Previous month in sidebar">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <button class="icon-btn" id="mini-next" aria-label="Next month in sidebar">
        <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
      </button>`
    : `<span class="mini-nav-spacer"></span>`;

  return `<div class="mini-month">
    <div class="mini-head">
      <div class="mini-label">${MONTHS[month]} ${year}</div>
      ${nav}
    </div>
    <div class="mini-dows">${DOW.map((d) => `<span>${d}</span>`).join("")}</div>
    <div class="mini-grid">${days}</div>
  </div>`;
}

function renderMiniCal() {
  const el = document.getElementById("mini-cal");
  const { miniYear: year, miniMonth: month } = state;
  const today = new Date();
  const range = viewRange();

  el.innerHTML = [0, 1, 2]
    .map((offset) => {
      const d = new Date(year, month + offset, 1);
      return miniMonthHtml(d.getFullYear(), d.getMonth(), range, today, offset === 0);
    })
    .join("");

  el.querySelector("#mini-prev").addEventListener("click", () => {
    const d = new Date(year, month - 1, 1);
    state.miniYear = d.getFullYear();
    state.miniMonth = d.getMonth();
    renderMiniCal();
  });
  el.querySelector("#mini-next").addEventListener("click", () => {
    const d = new Date(year, month + 1, 1);
    state.miniYear = d.getFullYear();
    state.miniMonth = d.getMonth();
    renderMiniCal();
  });
  el.querySelectorAll(".mini-day").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [y, m, day] = btn.dataset.date.split("-").map(Number);
      goToFriday(upcomingFriday(new Date(y, m - 1, day)));
    });
  });
}

function renderCalList() {
  const el = document.getElementById("cal-list");
  el.innerHTML = state.calendars
    .map((cal) => {
      const checked = !state.hidden.has(cal.id) ? "checked" : "";
      return `<label class="cal-item" style="--cal-color:${cal.backgroundColor}">
        <input type="checkbox" data-id="${cal.id}" ${checked} />
        <span class="name">${escapeHtml(cal.summary)}</span>
      </label>`;
    })
    .join("");
  el.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.hidden.delete(input.dataset.id);
      else state.hidden.add(input.dataset.id);
      localStorage.setItem(STORAGE_HIDDEN, JSON.stringify([...state.hidden]));
      renderGrid();
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function hidePopover() {
  document.getElementById("popover").classList.add("hidden");
}

function showPopover(html, anchor) {
  const pop = document.getElementById("popover");
  pop.innerHTML = `<button class="icon-btn popover-close" aria-label="Close">${closeSvg()}</button>${html}`;
  pop.classList.remove("hidden");
  pop.querySelector(".popover-close").addEventListener("click", hidePopover);

  const rect = anchor.getBoundingClientRect();
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
  if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 6);
  pop.style.left = `${Math.max(12, left)}px`;
  pop.style.top = `${top}px`;
}

function closeSvg() {
  return `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
}

function eventDetailHtml(event) {
  const cal = state.calendars.find((item) => item.id === event.calendarId);
  const open = event.htmlLink
    ? `<p><a href="${escapeHtml(event.htmlLink)}" target="_blank" rel="noopener">Open in Google Calendar</a></p>`
    : "";
  return `<h3>${escapeHtml(event.title)}</h3>
    <p class="when">${escapeHtml(formatRange(event))}</p>
    <p class="cal-name">${escapeHtml(cal?.summary || "Calendar")}</p>
    ${open}`;
}

function showEvent(event, anchor) {
  showPopover(eventDetailHtml(event), anchor);
}

function showDayMore(day, events, anchor) {
  const label = day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const rows = events
    .map((event) => {
      const time = event.allDay ? "All day" : formatTime(event.start);
      return `<div class="event-row" data-id="${escapeHtml(event.id)}">
        <span class="dot" style="background:${event.color}"></span>
        <span class="time">${escapeHtml(time)}</span>
        <span class="title">${escapeHtml(event.title)}</span>
      </div>`;
    })
    .join("");
  showPopover(`<h3>${escapeHtml(label)}</h3>${rows}`, anchor);
  document.querySelectorAll("#popover .event-row").forEach((row) => {
    row.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const event = events.find((item) => item.id === row.dataset.id);
      if (event) showEvent(event, row);
    });
  });
}

function dateLabel(day) {
  const isFriday = day.getDay() === 5;
  const isMonthStart = day.getDate() === 1;
  if (isFriday || isMonthStart) {
    return day.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return String(day.getDate());
}

function dayCellHtml(day, today, monthBreak) {
  const isSaturday = day.getDay() === 6;
  const outside = !isSaturday && day.getMonth() !== state.startFriday.getMonth();
  const todayClass = isSameDay(day, today) ? " today" : "";
  const satClass = isSaturday ? " saturday" : "";
  const breakClass = monthBreak ? " month-break" : "";
  return `<div class="day-cell${outside ? " outside" : ""}${todayClass}${satClass}${breakClass}">
    <div class="date-num"><span>${dateLabel(day)}</span></div>
    <div class="timed-list"></div>
  </div>`;
}

function weekendGroupHtml(weekend, today, previousWeekend) {
  return `${weekend.days
    .map((day, index) => {
      const previousDay = previousWeekend?.days[index];
      const monthBreak = Boolean(
        previousDay &&
          (day.getMonth() !== previousDay.getMonth() ||
            day.getFullYear() !== previousDay.getFullYear())
      );
      return dayCellHtml(day, today, monthBreak);
    })
    .join("")}
    <div class="bars-layer"></div>`;
}

function renderGrid() {
  const rowsEl = document.getElementById("weekend-rows");
  rowsEl.querySelectorAll(".days-wrap").forEach((wrap) => wrap._ro?.disconnect());
  const weekends = weekendsInView();
  const events = visibleEvents();
  const today = new Date();
  const rowCount = WEEKENDS_SHOWN / 2;

  document.getElementById("month-title").textContent = viewTitle(weekends);

  rowsEl.innerHTML = Array.from({ length: rowCount }, (_, rowIndex) => {
    const left = weekends[rowIndex];
    const right = weekends[rowIndex + rowCount];
    const previousLeft = rowIndex > 0 ? weekends[rowIndex - 1] : null;
    const previousRight = weekends[rowIndex + rowCount - 1];
    return `<div class="weekend-row">
      <div class="days-wrap">${weekendGroupHtml(left, today, previousLeft)}</div>
      <div class="gap-cell"></div>
      <div class="days-wrap">${weekendGroupHtml(right, today, previousRight)}</div>
    </div>`;
  }).join("");

  rowsEl.querySelectorAll(".weekend-row").forEach((rowEl, rowIndex) => {
    const wraps = rowEl.querySelectorAll(".days-wrap");
    paintWeekend(wraps[0], weekends[rowIndex], events);
    paintWeekend(wraps[1], weekends[rowIndex + rowCount], events);
  });
}

function paintWeekend(wrap, weekend, events) {
  const layer = wrap.querySelector(".bars-layer");
  const lists = [...wrap.querySelectorAll(".timed-list")];
  const layout = layoutWeekend(weekend.days, events);

  const paint = () => {
    const header = 28;
    const slot = 22;
    const maxSlots = Math.max(1, Math.floor((wrap.clientHeight - header - 2) / slot));
    const overflow = hasOverflow(layout, maxSlots);
    const visibleSlots = overflow ? maxSlots - 1 : maxSlots;
    const visibleLanes = Math.min(layout.laneCount, visibleSlots);

    layer.innerHTML = "";
    for (const bar of layout.bars) {
      if (bar.lane >= visibleLanes) continue;
      const el = document.createElement("div");
      el.className = "bar";
      if (bar.continuesLeft) el.classList.add("continues-left");
      if (bar.continuesRight) el.classList.add("continues-right");
      el.textContent = bar.event.title;
      el.title = bar.event.title;
      el.style.background = bar.event.color;
      el.style.color = textOn(bar.event.color);
      el.style.left = `calc(${(bar.startIdx / 3) * 100}% + ${bar.continuesLeft ? 0 : 4}px)`;
      el.style.width = `calc(${(bar.span / 3) * 100}% - ${
        (bar.continuesLeft ? 0 : 4) + (bar.continuesRight ? 0 : 4)
      }px)`;
      el.style.top = `${bar.lane * slot}px`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        showEvent(bar.event, el);
      });
      layer.appendChild(el);
    }

    layout.timedByDay.forEach((list, dayIndex) => {
      const hiddenBars = layout.bars.filter(
        (bar) => bar.lane >= visibleLanes && dayIndex >= bar.startIdx && dayIndex <= bar.endIdx
      ).length;
      const timedRoom = Math.max(0, visibleSlots - visibleLanes);
      const needsMore = hiddenBars + list.length > timedRoom;
      const shownTimed = needsMore ? Math.max(0, timedRoom - 1) : list.length;
      const hiddenTimed = list.length - shownTimed;
      const moreCount = hiddenBars + hiddenTimed;

      lists[dayIndex].style.paddingTop = `${visibleLanes * slot}px`;
      lists[dayIndex].innerHTML = "";
      list.slice(0, shownTimed).forEach((event) => {
        const el = document.createElement("div");
        el.className = "timed";
        el.innerHTML = `<span class="dot" style="background:${event.color}"></span>
          <span class="time">${escapeHtml(formatTime(event.start))}</span>
          <span class="title">${escapeHtml(event.title)}</span>`;
        el.title = `${formatTime(event.start)} ${event.title}`;
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          showEvent(event, el);
        });
        lists[dayIndex].appendChild(el);
      });
      if (moreCount > 0) {
        const more = document.createElement("div");
        more.className = "more-link";
        more.textContent = `${moreCount} more`;
        more.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const dayEvents = [
            ...layout.bars
              .filter((bar) => dayIndex >= bar.startIdx && dayIndex <= bar.endIdx)
              .map((bar) => bar.event),
            ...list,
          ];
          showDayMore(weekend.days[dayIndex], dayEvents, more);
        });
        lists[dayIndex].appendChild(more);
      }
    });
  };

  paint();
  if (wrap._ro) wrap._ro.disconnect();
  wrap._ro = new ResizeObserver(() => paint());
  wrap._ro.observe(wrap);
}

function hasOverflow(layout, maxSlots) {
  if (layout.laneCount > maxSlots) return true;
  return layout.timedByDay.some((list) => layout.laneCount + list.length > maxSlots);
}

function goToFriday(friday) {
  state.startFriday = startOfDay(friday);
  state.miniYear = state.startFriday.getFullYear();
  state.miniMonth = state.startFriday.getMonth();
  onViewChange();
}

function shiftWeekends(count) {
  goToFriday(addDays(state.startFriday, count * 7));
}

function onViewChange() {
  if (!state.connected) {
    state.events = demoEvents(state.startFriday);
    renderAll();
    return;
  }
  ensureFreshToken()
    .then(() => loadGoogleEvents())
    .catch((err) => {
      console.error(err);
      state.events = demoEvents(state.startFriday);
      renderAll();
    });
}

function wantsSession() {
  return localStorage.getItem(STORAGE_SESSION) === "1";
}

function connectButtonLabel() {
  if (state.connected) return "Connected";
  if (wantsSession()) return "Reconnect";
  return "Connect Google Calendar";
}

function renderAll() {
  document.getElementById("demo-banner").classList.toggle("hidden", state.connected);
  document.getElementById("connect-btn").textContent = connectButtonLabel();
  renderMiniCal();
  renderCalList();
  renderGrid();
}

function waitForGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > 8000) {
        clearInterval(timer);
        reject(new Error("Google Identity Services did not load"));
      }
    }, 50);
  });
}

async function apiGet(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  if (res.status === 401) {
    await requestToken({ prompt: "" });
    const retry = await fetch(url, {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (!retry.ok) throw new Error(`Calendar API ${retry.status}`);
    return retry.json();
  }
  if (!res.ok) throw new Error(`Calendar API ${res.status}`);
  return res.json();
}

async function apiGetAll(url) {
  const items = [];
  let pageUrl = url;
  for (;;) {
    const data = await apiGet(pageUrl);
    items.push(...(data.items || []));
    if (!data.nextPageToken) return items;
    const joiner = pageUrl.includes("?") ? "&" : "?";
    pageUrl = `${url}${joiner}pageToken=${encodeURIComponent(data.nextPageToken)}`;
  }
}

function toIso(d) {
  return d.toISOString();
}

function parseEvent(item, calendar) {
  const color = item.colorId ? colorFromId(item.colorId, calendar) : calendar.backgroundColor;
  if (item.start?.date) {
    const [y, m, d] = item.start.date.split("-").map(Number);
    const [ey, em, ed] = (item.end?.date || item.start.date).split("-").map(Number);
    return {
      id: `${calendar.id}:${item.id}:${item.start.date}`,
      calendarId: calendar.id,
      title: item.summary || "(No title)",
      start: new Date(y, m - 1, d),
      end: new Date(ey, em - 1, ed),
      allDay: true,
      color,
      htmlLink: item.htmlLink || null,
    };
  }
  return {
    id: `${calendar.id}:${item.id}:${item.start?.dateTime}`,
    calendarId: calendar.id,
    title: item.summary || "(No title)",
    start: new Date(item.start.dateTime),
    end: new Date(item.end?.dateTime || item.start.dateTime),
    allDay: false,
    color,
    htmlLink: item.htmlLink || null,
  };
}

const EVENT_COLORS = {
  1: "#a4bdfc",
  2: "#7ae7bf",
  3: "#dbadff",
  4: "#ff887c",
  5: "#fbd75b",
  6: "#ffb878",
  7: "#46d6db",
  8: "#e1e1e1",
  9: "#5484ed",
  10: "#51b749",
  11: "#dc2127",
};

function colorFromId(colorId, calendar) {
  return EVENT_COLORS[colorId] || calendar.backgroundColor;
}

async function loadGoogleEvents() {
  const weekends = weekendsInView();
  const timeMin = addDays(weekends[0].days[0], -1);
  const timeMax = addDays(weekends[weekends.length - 1].days[2], 2);
  const groups = await Promise.all(
    state.calendars.map(async (cal) => {
      const params = new URLSearchParams({
        timeMin: toIso(timeMin),
        timeMax: toIso(timeMax),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "2500",
      });
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        cal.id
      )}/events?${params}`;
      const items = await apiGetAll(url);
      return items
        .filter((item) => item.status !== "cancelled")
        .map((item) => parseEvent(item, cal));
    })
  );
  state.events = groups.flat();
  renderAll();
}

async function loadCalendars() {
  const items = await apiGetAll("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250");
  state.calendars = items
    .filter((item) => item.selected !== false)
    .map((item) => ({
      id: item.id,
      summary: item.summaryOverride || item.summary,
      backgroundColor: item.backgroundColor || "#039be5",
      foregroundColor: item.foregroundColor || "#fff",
    }));
}

function readSavedToken() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_TOKEN) || "null");
    if (!data?.access_token || !data.expires_at) return null;
    if (Date.now() >= data.expires_at) return null;
    return data;
  } catch {
    return null;
  }
}

function saveToken(resp) {
  const expiresIn = Number(resp.expires_in) || 3600;
  const expiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;
  state.token = resp.access_token;
  state.tokenExpiresAt = expiresAt;
  state.connected = true;
  localStorage.setItem(STORAGE_SESSION, "1");
  localStorage.setItem(
    STORAGE_TOKEN,
    JSON.stringify({ access_token: resp.access_token, expires_at: expiresAt })
  );
  disarmGestureReconnect();
}

function clearSavedToken() {
  localStorage.removeItem(STORAGE_TOKEN);
  state.token = null;
  state.tokenExpiresAt = 0;
}

function applySavedToken(saved) {
  state.token = saved.access_token;
  state.tokenExpiresAt = saved.expires_at;
  state.connected = true;
  state.calendars = [];
  state.events = [];
}

function tokenIsFresh() {
  return Boolean(state.token) && Date.now() < state.tokenExpiresAt - 60 * 1000;
}

async function ensureTokenClient() {
  const clientId = getClientId();
  if (!clientId) throw new Error("Missing OAuth client ID");
  await waitForGis();
  if (state.tokenClient) return state.tokenClient;
  state.tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: CALENDAR_SCOPE,
    prompt: "",
    callback: () => {},
    error_callback: () => {},
  });
  return state.tokenClient;
}

let tokenRequest = null;
let gestureReconnect = null;

function requestToken({ prompt } = {}) {
  if (tokenRequest) return tokenRequest;
  tokenRequest = new Promise((resolve, reject) => {
    if (!state.tokenClient) {
      reject(new Error("Sign-in is not ready"));
      return;
    }
    let settled = false;
    let timer = 0;
    const finish = (fn) => (arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };
    state.tokenClient.callback = finish((resp) => {
      if (resp.error) {
        reject(new Error(resp.error));
        return;
      }
      saveToken(resp);
      resolve(resp);
    });
    state.tokenClient.error_callback = finish((err) => {
      reject(new Error(err?.message || err?.type || "Sign-in cancelled"));
    });
    const waitMs = prompt === "none" ? 4000 : 120000;
    timer = setTimeout(
      finish(() => reject(new Error("Sign-in timed out"))),
      waitMs
    );
    state.tokenClient.requestAccessToken({ prompt: prompt ?? "" });
  }).finally(() => {
    tokenRequest = null;
  });
  return tokenRequest;
}

async function ensureFreshToken() {
  if (tokenIsFresh()) return;
  await ensureTokenClient();
  await requestToken({ prompt: "" });
}

function armGestureReconnect() {
  disarmGestureReconnect();
  if (!wantsSession() || !getClientId()) return;
  const handler = async (ev) => {
    if (ev.target.closest("#settings-modal, #modal-backdrop, #signout-btn, input, textarea, a")) {
      return;
    }
    disarmGestureReconnect();
    if (!wantsSession() || state.connected) return;
    try {
      await ensureTokenClient();
      await requestToken({ prompt: "" });
      await loadCalendars();
      await loadGoogleEvents();
    } catch (err) {
      console.error(err);
    }
  };
  gestureReconnect = handler;
  document.addEventListener("pointerdown", handler, true);
}

function disarmGestureReconnect() {
  if (!gestureReconnect) return;
  document.removeEventListener("pointerdown", gestureReconnect, true);
  gestureReconnect = null;
}

async function loadConnectedCalendars() {
  await loadCalendars();
  await loadGoogleEvents();
}

async function trySilentConnect() {
  await ensureTokenClient();
  await requestToken({ prompt: "none" });
  await loadConnectedCalendars();
}

async function restoreSession() {
  if (!getClientId()) return;
  const saved = readSavedToken();
  if (saved) {
    applySavedToken(saved);
    renderAll();
    try {
      await ensureTokenClient();
      await loadConnectedCalendars();
      return;
    } catch (err) {
      console.error(err);
      clearSavedToken();
      state.connected = false;
      state.calendars = DEMO_CALENDARS.slice();
      state.events = demoEvents(state.startFriday);
      renderAll();
    }
  }
  if (!wantsSession()) return;
  try {
    await trySilentConnect();
  } catch (err) {
    console.error(err);
    state.connected = false;
    clearSavedToken();
    state.calendars = DEMO_CALENDARS.slice();
    state.events = demoEvents(state.startFriday);
    renderAll();
    armGestureReconnect();
  }
}

async function connect() {
  const clientId = getClientId();
  if (!clientId) {
    openSettings();
    return;
  }
  await ensureTokenClient();
  if (!tokenIsFresh()) {
    await requestToken({ prompt: "" });
  }
  await loadConnectedCalendars();
}

function signOut() {
  disarmGestureReconnect();
  if (state.token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(state.token, () => {});
  }
  clearSavedToken();
  localStorage.removeItem(STORAGE_SESSION);
  state.connected = false;
  state.tokenClient = null;
  state.calendars = DEMO_CALENDARS.slice();
  state.hidden = new Set();
  onViewChange();
}

function openSettings() {
  document.getElementById("origin-preview").textContent = window.location.origin;
  document.getElementById("client-id-input").value = getClientId();
  document.getElementById("modal-backdrop").classList.remove("hidden");
  document.getElementById("settings-modal").classList.remove("hidden");
}

function closeSettings() {
  document.getElementById("modal-backdrop").classList.add("hidden");
  document.getElementById("settings-modal").classList.add("hidden");
}

function bind() {
  document.getElementById("today-btn").addEventListener("click", () => {
    goToFriday(upcomingFriday());
  });
  document.getElementById("prev-btn").addEventListener("click", () => shiftWeekends(-1));
  document.getElementById("next-btn").addEventListener("click", () => shiftWeekends(1));
  document.getElementById("connect-btn").addEventListener("click", () => {
    if (state.connected) openSettings();
    else if (getClientId()) connect().catch((err) => {
      console.error(err);
      openSettings();
    });
    else openSettings();
  });
  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.getElementById("close-settings-btn").addEventListener("click", closeSettings);
  document.getElementById("modal-backdrop").addEventListener("click", closeSettings);
  document.getElementById("save-connect-btn").addEventListener("click", async () => {
    const value = document.getElementById("client-id-input").value.trim();
    if (value) localStorage.setItem(STORAGE_CLIENT, value);
    closeSettings();
    try {
      await connect();
    } catch (err) {
      console.error(err);
      alert(err.message || "Could not connect to Google Calendar.");
    }
  });
  document.getElementById("signout-btn").addEventListener("click", () => {
    signOut();
    closeSettings();
  });
  document.getElementById("sidebar-toggle").addEventListener("click", () => {
    const sidebar = document.getElementById("sidebar");
    if (window.matchMedia("(max-width: 900px)").matches) {
      sidebar.classList.toggle("open");
    } else {
      sidebar.classList.toggle("collapsed");
    }
  });
  document.addEventListener("click", (ev) => {
    const pop = document.getElementById("popover");
    if (!pop.classList.contains("hidden") && !pop.contains(ev.target)) hidePopover();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      hidePopover();
      closeSettings();
    }
    if (ev.target.matches("input, textarea")) return;
    if (ev.key === "ArrowLeft") shiftWeekends(-1);
    if (ev.key === "ArrowRight") shiftWeekends(1);
  });
  window.addEventListener("resize", () => renderGrid());
}

bind();
{
  const saved = readSavedToken();
  if (saved) applySavedToken(saved);
  else state.events = demoEvents(state.startFriday);
  renderAll();
}
restoreSession().catch((err) => console.error(err));
