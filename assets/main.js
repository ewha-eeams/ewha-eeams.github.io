const isEnglish = document.documentElement.lang.startsWith("en");

const copy = {
  noResults: isEnglish ? "No archive results found." : "검색 결과가 없습니다.",
  loadError: isEnglish ? "Data could not be loaded." : "자료를 불러오지 못했습니다.",
  moreWorks: (count) => (isEnglish ? `+ ${count} more works` : `외 ${count}작품`),
};

const concertList = document.querySelector("#concert-list");
const projectGrid = document.querySelector("#project-grid");
const educationList = document.querySelector("#education-list");
const peopleGrid = document.querySelector("#people-grid");
const yearFilter = document.querySelector("#year-filter");
const archiveSearch = document.querySelector("#archive-search");
const menuToggle = document.querySelector(".menu-toggle");
const siteMenu = document.querySelector("#site-menu");

let concerts = [];

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim() !== "")) {
    rows.push(row);
  }

  const [headers = [], ...dataRows] = rows;
  return dataRows.map((dataRow) =>
    headers.reduce((record, header, index) => {
      record[header.replace(/^\uFEFF/, "").trim()] = (dataRow[index] || "").trim();
      return record;
    }, {}),
  );
}

async function loadCsv(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }
  return parseCsv(await response.text());
}

function localize(record, key) {
  const defaultValue = record[key] || "";
  const englishValue = record[`${key}_en`] || "";
  return isEnglish ? englishValue || defaultValue : defaultValue || englishValue;
}

function secondaryValue(record, key) {
  const primary = record[key] || "";
  const secondary = record[`${key}_en`] || "";
  return secondary && secondary !== primary ? secondary : "";
}

function bilingualHtml(primary, secondary, className = "bilingual-secondary") {
  const main = primary || secondary || "";
  const supporting = primary && secondary && secondary !== primary ? secondary : "";
  return `${escapeHtml(main)}${supporting ? `<span class="${className}" lang="en">${escapeHtml(supporting)}</span>` : ""}`;
}

function participationPeriod(record) {
  const start = record.start_year || record.year || "";
  const end = record.end_year || "";

  if (start && end) {
    return `${start}–${end}`;
  }

  if (start) {
    return `${start}–`;
  }

  return "";
}

function parseArchiveDate(date = "", year = "") {
  const normalizedDate = String(date).trim();
  const fallbackYear = Number.parseInt(year, 10) || 0;
  const exactDate = normalizedDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const yearOnly = normalizedDate.match(/^(\d{4})$/);

  if (exactDate) {
    return {
      year: Number.parseInt(exactDate[1], 10),
      month: Number.parseInt(exactDate[2], 10),
      day: Number.parseInt(exactDate[3], 10),
    };
  }

  if (yearOnly) {
    return {
      year: Number.parseInt(yearOnly[1], 10),
      month: 0,
      day: 0,
    };
  }

  return {
    year: fallbackYear,
    month: 0,
    day: 0,
  };
}

function getArchiveYear(date = "") {
  const parsedDate = parseArchiveDate(date);
  return parsedDate.year ? String(parsedDate.year) : "";
}

function sortDatedRows(rows) {
  return rows
    .map((row, rowIndex) => ({
      ...row,
      rowIndex,
      sortDate: parseArchiveDate(localize(row, "date")),
    }))
    .sort(
      (a, b) =>
        b.sortDate.year - a.sortDate.year ||
        b.sortDate.month - a.sortDate.month ||
        b.sortDate.day - a.sortDate.day ||
        a.rowIndex - b.rowIndex,
    );
}

function groupConcerts(rows) {
  const byConcert = new Map();

  rows.forEach((row, rowIndex) => {
    const title = localize(row, "title");
    const date = localize(row, "date");
    const venue = localize(row, "venue");
    const year = getArchiveYear(date);
    const slug = (row.slug || "").trim().toLowerCase();
    const key = [year, slug || title, date, venue].join("|");

    if (!byConcert.has(key)) {
      byConcert.set(key, {
        year,
        title,
        titleEn: secondaryValue(row, "title"),
        date,
        venue,
        venueEn: secondaryValue(row, "venue"),
        slug,
        sortDate: parseArchiveDate(date),
        rowIndex,
        works: [],
      });
    }

    byConcert.get(key).works.push({
      composer: localize(row, "composer"),
      composerEn: secondaryValue(row, "composer"),
      title: localize(row, "work_title"),
      titleEn: secondaryValue(row, "work_title"),
      format: row.format || "",
      order: Number.parseInt(row.work_order, 10) || 0,
      rowIndex,
    });
  });

  byConcert.forEach((concert) => {
    concert.works.sort((a, b) =>
      (a.order || Infinity) - (b.order || Infinity) || a.rowIndex - b.rowIndex,
    );
  });

  return [...byConcert.values()].sort(
    (a, b) =>
      b.sortDate.year - a.sortDate.year ||
      b.sortDate.month - a.sortDate.month ||
      b.sortDate.day - a.sortDate.day ||
      a.rowIndex - b.rowIndex,
  );
}

function renderConcerts() {
  const recentConcerts = concerts.slice(0, 3);

  concertList.innerHTML = recentConcerts
    .map(
      (concert) => `
        <a class="concert-card" href="archive.html#${escapeHtml(`${concert.year}-${concert.slug}`)}">
          <header>
            <div>
              <time datetime="${escapeHtml(concert.date)}">${escapeHtml(concert.date)}</time>
              <h3>${bilingualHtml(concert.title, concert.titleEn)}</h3>
            </div>
            <span class="concert-card-arrow" aria-hidden="true">→</span>
          </header>
          <p class="meta">${bilingualHtml(concert.venue, concert.venueEn)}</p>
          <span class="concert-card-action">공연 정보 보기 <span lang="en">View Concert</span></span>
        </a>
      `,
    )
    .join("");

  if (recentConcerts.length === 0) {
    concertList.innerHTML = `<p class="meta">${copy.noResults}</p>`;
  }
}

function setupFilters() {
  if (!yearFilter || !archiveSearch) {
    return;
  }

  yearFilter.querySelectorAll("option:not(:first-child)").forEach((option) => option.remove());
  const years = [...new Set(concerts.map((concert) => concert.year))];
  years.forEach((year) => {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    yearFilter.append(option);
  });

  archiveSearch.addEventListener("input", renderConcerts);
  yearFilter.addEventListener("change", renderConcerts);
}

function renderProjects(rows) {
  const groups = new Map();

  rows
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .forEach((project) => {
      const group = localize(project, "project_group") || "Research Projects";
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group).push(project);
    });

  projectGrid.innerHTML = [...groups.entries()]
    .map(
      ([group, projects]) => {
        return `
        <section class="project-group" aria-label="${escapeHtml(group)}">
          <h3>${bilingualHtml(group, secondaryValue(projects[0], "project_group"))}</h3>
          <div class="project-group-grid">
            ${projects
              .map(
                (project) => {
                  const cardStart = project.url
                    ? `<a class="project-card" href="${escapeHtml(project.url)}" target="_blank" rel="noreferrer">`
                    : `<article class="project-card">`;
                  const cardEnd = project.url ? `</a>` : `</article>`;

                  return `
                  ${cardStart}
                    <span>${bilingualHtml(localize(project, "status"), secondaryValue(project, "status"))}</span>
                    <h4>${bilingualHtml(localize(project, "title"), secondaryValue(project, "title"))}</h4>
                    ${
                      localize(project, "description")
                        ? `<p>${bilingualHtml(localize(project, "description"), secondaryValue(project, "description"))}</p>`
                        : ""
                    }
                    ${
                      project.url
                        ? `<span class="project-action">${isEnglish ? "Open Module" : "모듈 열기"}</span>`
                        : ""
                    }
                  ${cardEnd}
                `;
                },
              )
              .join("")}
          </div>
        </section>
      `;
      },
    )
    .join("");
}

function renderEducation(rows) {
  const latestByType = [];
  const seenTypes = new Set();

  sortDatedRows(rows).forEach((row) => {
    const type = localize(row, "type");
    if (!seenTypes.has(type)) {
      seenTypes.add(type);
      latestByType.push(row);
    }
  });

  educationList.innerHTML = latestByType
    .map(
      (row) => {
        const meta = [localize(row, "date"), localize(row, "speaker")].filter(Boolean).join(" · ");
        const metaEn = [secondaryValue(row, "speaker")].filter(Boolean).join(" · ");

        return `
          <li>
            <span>${bilingualHtml(localize(row, "type"), secondaryValue(row, "type"))}</span>
            <strong>${bilingualHtml(localize(row, "title"), secondaryValue(row, "title"))}</strong>
            ${meta ? `<p class="meta">${bilingualHtml(meta, metaEn)}</p>` : ""}
            <p>${bilingualHtml(localize(row, "description"), secondaryValue(row, "description"))}</p>
            <a class="education-card-action" href="education.html#${escapeHtml(`${getArchiveYear(localize(row, "date"))}-${(row.slug || "").toLowerCase()}`)}">
              자료 보기 <span lang="en">View Record</span>
            </a>
          </li>
        `;
      },
    )
    .join("");
}

function groupPeople(rows) {
  const groups = new Map();

  rows
    .slice()
    .filter((row) => row.public !== "no")
    .sort(
      (a, b) =>
        Number(a.order || 0) - Number(b.order || 0) ||
        Number(a.person_order || 0) - Number(b.person_order || 0),
    )
    .forEach((row) => {
      const category = localize(row, "category");
      const key = `${row.order}|${category}`;

      if (!groups.has(key)) {
        groups.set(key, {
          section: localize(row, "section"),
          sectionEn: secondaryValue(row, "section"),
          category,
          categoryEn: secondaryValue(row, "category"),
          people: [],
          note: localize(row, "note"),
          noteEn: secondaryValue(row, "note"),
        });
      }

      const group = groups.get(key);
      if (!group.note && localize(row, "note")) {
        group.note = localize(row, "note");
      }
      if (localize(row, "name")) {
        group.people.push({
          name: localize(row, "name"),
          nameEn: secondaryValue(row, "name"),
          role: localize(row, "role"),
          roleEn: secondaryValue(row, "role"),
          period: participationPeriod(row),
          date: localize(row, "date"),
          year: row.year,
          status: row.status,
          project: localize(row, "project"),
          profileUrl: row.profile_url,
        });
      }
    });

  return [...groups.values()];
}

function renderPeople(rows) {
  peopleGrid.innerHTML = groupPeople(rows)
    .map((group) => {
      return `
        <article>
          <span>${bilingualHtml(group.section, group.sectionEn)}</span>
          <h3>${bilingualHtml(group.category, group.categoryEn)}</h3>
          ${
            group.people.length
              ? `<ul class="person-list">
                  ${group.people
                    .map(
                      (person) =>
                        `<li><strong>${bilingualHtml(person.name, person.nameEn)}</strong><span>${bilingualHtml(person.role, person.roleEn)}</span></li>`,
                    )
                    .join("")}
                </ul>`
              : ""
          }
          ${group.note ? `<p class="person-note">${bilingualHtml(group.note, group.noteEn)}</p>` : ""}
        </article>
      `;
    })
    .join("");
}

function setupMenu() {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !siteMenu.classList.contains("is-open")) return;
    siteMenu.classList.remove("is-open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.focus();
  });
  menuToggle.addEventListener("click", () => {
    const isOpen = siteMenu.classList.toggle("is-open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  });

  siteMenu.addEventListener("click", (event) => {
    if (event.target.matches("a")) {
      siteMenu.classList.remove("is-open");
      menuToggle.setAttribute("aria-expanded", "false");
    }
  });
}

async function initData() {
  try {
    const [archiveRows, peopleRows, educationRows, researchRows] = await Promise.all([
      loadCsv("data/archive.csv"),
      loadCsv("data/people.csv"),
      loadCsv("data/education.csv"),
      loadCsv("data/research.csv"),
    ]);

    concerts = groupConcerts(archiveRows);
    setupFilters();
    renderConcerts();
    renderProjects(researchRows);
    renderPeople(peopleRows);
    renderEducation(educationRows);

    const hashTarget = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (hashTarget) {
      window.setTimeout(() => hashTarget.scrollIntoView({ block: "start" }), 0);
    }
  } catch (error) {
    console.error(error);
    concertList.innerHTML = `<p class="meta">${copy.loadError}</p>`;
    projectGrid.innerHTML = `<p class="meta">${copy.loadError}</p>`;
    peopleGrid.innerHTML = `<p class="meta">${copy.loadError}</p>`;
    educationList.innerHTML = `<li><p>${copy.loadError}</p></li>`;
  }
}

function setupMobileSections() {
  const media = matchMedia("(max-width: 680px)");
  const key = "eeams.mobile-sections.v1";
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(key)) || {}; } catch {}
  const sections = ["archive", "research", "education", "people", "structure"].map(id => {
    const section = document.getElementById(id);
    const heading = section.querySelector("h2");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "section-disclosure";
    button.innerHTML = heading.innerHTML;
    const label = document.createElement("span");
    label.className = "section-desktop-title";
    while (heading.firstChild) label.append(heading.firstChild);
    heading.append(label, button);
    const panels = [...section.children].slice(1);
    panels.forEach((panel, index) => { panel.id ||= id + "-panel-" + index; });
    button.setAttribute("aria-controls", panels.map(panel => panel.id).join(" "));
    section.classList.add("mobile-disclosure-section");
    const entry = { section, button, open: saved[id] === true };
    const update = () => {
      section.classList.toggle("is-collapsed", media.matches && !entry.open);
      button.setAttribute("aria-expanded", String(entry.open));
    };
    button.addEventListener("click", () => {
      entry.open = !entry.open;
      saved[id] = entry.open;
      try { sessionStorage.setItem(key, JSON.stringify(saved)); } catch {}
      update();
    });
    entry.update = update;
    update();
    return entry;
  });
  function reveal(hash) {
    let target;
    try { target = document.getElementById(decodeURIComponent(hash.slice(1))); } catch { return; }
    const entry = sections.find(item => item.section === target || item.section.contains(target));
    if (!entry) return;
    entry.open = true;
    saved[entry.section.id] = true;
    try { sessionStorage.setItem(key, JSON.stringify(saved)); } catch {}
    entry.update();
  }
  document.addEventListener("click", event => {
    const link = event.target.closest("a[href]");
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.origin === location.origin && url.pathname === location.pathname) reveal(url.hash);
  }, true);
  window.addEventListener("hashchange", () => reveal(location.hash));
  media.addEventListener("change", () => sections.forEach(entry => entry.update()));
  reveal(location.hash);
}

setupMobileSections();
setupMenu();
initData();
