const isEnglish = document.documentElement.lang.startsWith("en");
const page = document.body.dataset.page;
const detailList = document.querySelector("#detail-list");
const archiveDetailSearch = document.querySelector("#archive-detail-search");
const archiveDetailYearFilter = document.querySelector("#archive-detail-year-filter");
const educationSearch = document.querySelector("#education-search");
const educationYearFilter = document.querySelector("#education-year-filter");
const educationTypeFilter = document.querySelector("#education-type-filter");
const menuToggle = document.querySelector(".menu-toggle");
const siteMenu = document.querySelector("#site-menu");

const copy = {
  loadError: isEnglish ? "Data could not be loaded." : "자료를 불러오지 못했습니다.",
  noRecords: isEnglish ? "No records yet." : "아직 등록된 자료가 없습니다.",
  materials: isEnglish ? "Materials" : "자료 보기",
  archiveLink: isEnglish ? "View Concert Archive" : "콘서트 아카이브 보기",
  programBook: isEnglish ? "Program Book" : "프로그램북",
  poster: isEnglish ? "Poster" : "포스터",
  photos: isEnglish ? "Photos" : "사진",
  media: isEnglish ? "Media" : "자료 보기",
  ledBy: isEnglish ? "Led by" : "진행",
  archiveDetails: isEnglish ? "View concert" : "공연 정보 보기",
  archiveClose: isEnglish ? "Close concert" : "공연 정보 접기",
  educationDetails: isEnglish ? "View details" : "내용 보기",
  educationClose: isEnglish ? "Close details" : "내용 접기",
};

let educationRows = [];
let archiveRows = [];
const mediaAvailability = new Map();

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

function parseArchiveDate(date = "") {
  const normalizedDate = String(date).trim();
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
    year: 0,
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

function setupArchiveResourceLinks() {
  document.addEventListener("click", (event) => {
    if (event.target.closest(".archive-resource-link")) {
      event.stopPropagation();
    }
  });
}

function renderEducation(rows) {
  if (!rows.length) {
    detailList.innerHTML = `<p class="meta">${copy.noRecords}</p>`;
    return;
  }

  const query = educationSearch?.value.trim().toLowerCase() || "";
  const selectedYear = educationYearFilter?.value || "all";
  const selectedType = educationTypeFilter?.value || "all";
  const filteredRows = sortDatedRows(rows).filter((row) => {
    const date = localize(row, "date");
    const type = localize(row, "type");
    const year = getArchiveYear(date);
    const searchable = [
      date,
      type,
      localize(row, "title"),
      localize(row, "speaker"),
      localize(row, "description"),
    ]
      .join(" ")
      .toLowerCase();

    return (
      (selectedYear === "all" || year === selectedYear) &&
      (selectedType === "all" || type === selectedType) &&
      (!query || searchable.includes(query))
    );
  });

  if (!filteredRows.length) {
    detailList.innerHTML = `<p class="meta">${copy.noRecords}</p>`;
    return;
  }

  const groups = new Map();
  filteredRows.forEach((row) => {
    const year = getArchiveYear(localize(row, "date")) || "Unknown";
    if (!groups.has(year)) {
      groups.set(year, []);
    }
    groups.get(year).push(row);
  });

  detailList.innerHTML = [...groups.entries()]
    .map(([year, groupRows]) => {
      const items = groupRows
        .map((row) => {
      const displayDate = localize(row, "date");
      const isLocalMedia = row.materials?.startsWith("assets/media/");
      const materialLabel = /-poster\.(jpe?g|png|pdf)$/i.test(row.materials || "")
        ? copy.poster
        : copy.materials;
      const recordId = `${getArchiveYear(displayDate)}-${(row.slug || "").toLowerCase()}`;
      const materialUrl = isLocalMedia
        ? archiveMediaViewerUrl(row.materials, materialLabel, "education", recordId)
        : row.materials;
      const materials = materialUrl
        ? `<a class="person-action" href="${escapeHtml(materialUrl)}" target="_blank" rel="noreferrer">${materialLabel}</a>`
        : "";
      const speaker = localize(row, "speaker");
      const speakerEn = secondaryValue(row, "speaker");
          const description = localize(row, "description");

      return `
            <details class="education-record" id="${escapeHtml(`${getArchiveYear(displayDate)}-${(row.slug || "").toLowerCase()}`)}">
              <summary>
                <time>${escapeHtml(displayDate)}</time>
                <span>${bilingualHtml(localize(row, "type"), secondaryValue(row, "type"))}</span>
                <strong>${bilingualHtml(localize(row, "title"), secondaryValue(row, "title"))}</strong>
                ${speaker ? `<em>${copy.ledBy} - ${bilingualHtml(speaker, speakerEn)}</em>` : ""}
                <span class="record-toggle">
                  <span class="record-toggle-open">${copy.educationDetails}</span>
                  <span class="record-toggle-close">${copy.educationClose}</span>
                  <span class="record-toggle-icon" aria-hidden="true"></span>
                </span>
              </summary>
              ${
                description
                  ? `<p>${bilingualHtml(description, secondaryValue(row, "description")).replace(/\n/g, "<br />")}</p>`
                  : ""
              }
          ${materials}
            </details>
      `;
        })
        .join("");

      return `
        <section class="education-year-group" aria-label="${escapeHtml(year)}">
          <h2>${escapeHtml(year)}</h2>
          <div class="education-records">${items}</div>
        </section>
      `;
    })
    .join("");

  const linkedRecord = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
  if (linkedRecord instanceof HTMLDetailsElement) {
    linkedRecord.open = true;
    window.setTimeout(() => linkedRecord.scrollIntoView({ block: "start" }), 0);
  }
}

function setupEducationFilters(rows) {
  if (!educationSearch || !educationYearFilter || !educationTypeFilter) {
    return;
  }

  const sortedRows = sortDatedRows(rows);
  const years = [...new Set(sortedRows.map((row) => getArchiveYear(localize(row, "date"))).filter(Boolean))];
  const types = [...new Set(sortedRows.map((row) => localize(row, "type")).filter(Boolean))];

  years.forEach((year) => {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    educationYearFilter.append(option);
  });

  types.forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type;
    educationTypeFilter.append(option);
  });

  [educationSearch, educationYearFilter, educationTypeFilter].forEach((control) => {
    control.addEventListener("input", () => renderEducation(educationRows));
    control.addEventListener("change", () => renderEducation(educationRows));
  });
}

function normalizeSlug(value = "") {
  return String(value).trim().toLowerCase();
}

function parseWorkOrder(value = "") {
  const order = Number.parseInt(value, 10);
  return Number.isFinite(order) ? order : 0;
}

function groupConcerts(rows) {
  const byConcert = new Map();

  rows
    .forEach((row, rowIndex) => {
      const title = localize(row, "title");
      const date = localize(row, "date");
      const venue = localize(row, "venue");
      const year = getArchiveYear(date);
      const slug = normalizeSlug(row.slug);
      const key = [year, slug || title, date, venue].join("|");

      if (!byConcert.has(key)) {
        byConcert.set(key, {
          year,
          slug,
          title,
          titleEn: secondaryValue(row, "title"),
          date,
          venue,
          venueEn: secondaryValue(row, "venue"),
          sortDate: parseArchiveDate(date),
          mediaUrl: row.media_url,
          works: [],
        });
      }

      const concert = byConcert.get(key);
      concert.works.push({
        composer: localize(row, "composer"),
        composerEn: secondaryValue(row, "composer"),
        order: parseWorkOrder(row.work_order),
        rowIndex,
        title: localize(row, "work_title"),
        titleEn: secondaryValue(row, "work_title"),
        format: row.format || "",
      });
    });

  const concerts = [...byConcert.values()].map((concert) => ({
    ...concert,
    works: concert.works.slice().sort((a, b) => {
      if (a.order && b.order) {
        return a.order - b.order;
      }
      if (a.order) {
        return -1;
      }
      if (b.order) {
        return 1;
      }
      return a.rowIndex - b.rowIndex;
    }),
  }));

  return concerts.sort(
    (a, b) =>
      b.sortDate.year - a.sortDate.year ||
      b.sortDate.month - a.sortDate.month ||
      b.sortDate.day - a.sortDate.day,
  );
}

function archiveMediaViewerUrl(url, label, returnPage = "archive", recordId = "") {
  const params = new URLSearchParams({
    src: url,
    label,
    lang: isEnglish ? "en" : "ko",
    from: returnPage,
  });
  if (recordId) params.set("record", recordId);
  return `media.html?${params.toString()}`;
}

function archiveGalleryViewerUrl(concert) {
  const params = new URLSearchParams({
    gallery: mediaPath(concert, "photo"),
    label: `${concert.title} · ${copy.photos}`,
    lang: isEnglish ? "en" : "ko",
    from: "archive",
    record: `${concert.year}-${concert.slug}`,
  });
  return `media.html?${params.toString()}`;
}

function mediaLink(url, label, useViewer = false, recordId = "") {
  const href = useViewer ? archiveMediaViewerUrl(url, label, "archive", recordId) : url;
  const availability = useViewer ? ` hidden data-media-src="${escapeHtml(url)}"` : "";
  return url
    ? `<a class="archive-resource-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer"${availability}>${escapeHtml(label)}</a>`
    : "";
}

function galleryLink(concert) {
  const firstPhoto = mediaPath(concert, "photo1.jpg");
  return `<a class="archive-resource-link" href="${escapeHtml(archiveGalleryViewerUrl(concert))}" target="_blank" rel="noreferrer" hidden data-media-src="${escapeHtml(firstPhoto)}">${escapeHtml(copy.photos)}</a>`;
}

function revealAvailableMediaLinks() {
  detailList.querySelectorAll("[data-media-src]").forEach((link) => {
    const path = link.dataset.mediaSrc;
    if (!mediaAvailability.has(path)) {
      mediaAvailability.set(path, fetch(path, { method: "HEAD", cache: "no-cache" })
        .then((response) => response.ok && /^(image\/|application\/pdf)/i.test(response.headers.get("content-type") || ""))
        .catch(() => false));
    }
    mediaAvailability.get(path).then((exists) => {
      if (link.isConnected) link.hidden = !exists;
    });
  });
}

function mediaPath(concert, suffix) {
  return `assets/media/concerts/${concert.year}/${concert.year}-${concert.slug}-${suffix}`;
}

function mediaBundle(concert) {
  if (!concert.year || !concert.slug) {
    return {
      links: concert.mediaUrl ? [mediaLink(concert.mediaUrl, copy.media)] : [],
    };
  }

  return {
    links: [
      mediaLink(mediaPath(concert, "program-book.pdf"), copy.programBook, true, `${concert.year}-${concert.slug}`),
      mediaLink(mediaPath(concert, "poster.jpg"), copy.poster, true, `${concert.year}-${concert.slug}`),
      galleryLink(concert),
      mediaLink(concert.mediaUrl, copy.media),
    ].filter(Boolean),
  };
}

function renderArchive(rows) {
  const concerts = groupConcerts(rows);
  if (!concerts.length) {
    detailList.innerHTML = `<p class="meta">${copy.noRecords}</p>`;
    return;
  }

  const query = archiveDetailSearch?.value.trim().toLowerCase() || "";
  const selectedYear = archiveDetailYearFilter?.value || "all";
  const filteredConcerts = concerts.filter((concert) => {
    const searchable = [
      concert.year,
      concert.date,
      concert.title,
      concert.titleEn,
      concert.venue,
      concert.venueEn,
      ...concert.works.flatMap((work) => [work.composer, work.composerEn, work.title, work.titleEn, work.format]),
    ]
      .join(" ")
      .toLowerCase();

    return (
      (selectedYear === "all" || concert.year === selectedYear) &&
      (!query || searchable.includes(query))
    );
  });

  if (!filteredConcerts.length) {
    detailList.innerHTML = `<p class="meta">${copy.noRecords}</p>`;
    return;
  }

  const groups = new Map();
  filteredConcerts.forEach((concert) => {
    const year = concert.year || "Unknown";
    if (!groups.has(year)) {
      groups.set(year, []);
    }
    groups.get(year).push(concert);
  });

  detailList.innerHTML = [...groups.entries()]
    .map(([year, groupConcerts]) => {
      const items = groupConcerts
        .map((concert) => {
          const media = mediaBundle(concert);
          const mediaLinks = media.links.join("");
          const workCount = concert.works.length;

          return `
            <details class="archive-record" id="${escapeHtml(`${concert.year}-${concert.slug}`)}">
              <summary>
                <span class="archive-record-meta">
                  <time>${escapeHtml(concert.date)}</time>
                  ${mediaLinks ? `<span class="archive-resource-links">${mediaLinks}</span>` : ""}
                </span>
                <strong>${bilingualHtml(concert.title, concert.titleEn)}</strong>
                <span>${bilingualHtml(concert.venue, concert.venueEn)}</span>
                <em>${escapeHtml(String(workCount))}</em>
                <span class="record-toggle">
                  <span class="record-toggle-open">${copy.archiveDetails}</span>
                  <span class="record-toggle-close">${copy.archiveClose}</span>
                  <span class="record-toggle-icon" aria-hidden="true"></span>
                </span>
              </summary>
              <ul class="archive-work-list">
                ${concert.works
                  .map((work) => {
                    return `
                  <li>
                    <p class="archive-work-composer">
                      <strong>${escapeHtml(work.composer)}${work.composerEn && work.composerEn !== work.composer ? `<span class="archive-work-composer-en" lang="en"> · ${escapeHtml(work.composerEn)}</span>` : ""}</strong>
                    </p>
                    <p class="archive-work-title">${bilingualHtml(work.title, work.titleEn, "archive-work-title-en")}</p>
                    ${work.format ? `<p class="archive-work-format">${escapeHtml(work.format)}</p>` : ""}
                  </li>
                `;
                  })
                  .join("")}
              </ul>
            </details>
      `;
        })
        .join("");

      return `
        <section class="record-year-group" aria-label="${escapeHtml(year)}">
          <h2>${escapeHtml(year)}</h2>
          <div class="archive-records">${items}</div>
        </section>
      `;
    })
    .join("");
  revealAvailableMediaLinks();

  const linkedRecord = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
  if (linkedRecord instanceof HTMLDetailsElement) {
    linkedRecord.open = true;
    window.setTimeout(() => linkedRecord.scrollIntoView({ block: "start" }), 0);
  }
}

function setupArchiveFilters(rows) {
  if (!archiveDetailSearch || !archiveDetailYearFilter) {
    return;
  }

  const concerts = groupConcerts(rows);
  const years = [...new Set(concerts.map((concert) => concert.year).filter(Boolean))];

  years.forEach((year) => {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    archiveDetailYearFilter.append(option);
  });

  [archiveDetailSearch, archiveDetailYearFilter].forEach((control) => {
    control.addEventListener("input", () => renderArchive(archiveRows));
    control.addEventListener("change", () => renderArchive(archiveRows));
  });
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
  const groups = groupPeople(rows);
  if (!groups.length) {
    detailList.innerHTML = `<p class="meta">${copy.noRecords}</p>`;
    return;
  }

  detailList.innerHTML = groups
    .map((group) => {
      const isArchiveGroup =
        group.section.includes("Student Composers");

      return `
        <article class="detail-card people-detail-card">
          <div class="detail-card-head">
            <span>${bilingualHtml(group.section, group.sectionEn)}</span>
          </div>
          <h2>${bilingualHtml(group.category, group.categoryEn)}</h2>
          ${
            group.people.length
              ? `<ul class="person-list detail-person-list">
                  ${group.people
                    .map((person) => {
                      const meta = person.project || "";
                      return `
                        <li>
                          <div>
                            <strong>${bilingualHtml(person.name, person.nameEn)}</strong>
                            ${meta ? `<p class="person-meta">${escapeHtml(meta)}</p>` : ""}
                            ${
                              person.profileUrl
                                ? `<a class="profile-link" href="${escapeHtml(person.profileUrl)}">Profile</a>`
                                : ""
                            }
                          </div>
                          <span>${bilingualHtml(person.role, person.roleEn)}</span>
                        </li>
                      `;
                    })
                    .join("")}
                </ul>`
              : ""
          }
          ${group.note ? `<p>${bilingualHtml(group.note, group.noteEn)}</p>` : ""}
          ${
            isArchiveGroup
              ? `<a class="person-action" href="index.html#archive">${copy.archiveLink}</a>`
              : ""
          }
        </article>
      `;
    })
    .join("");
}

async function init() {
  try {
    if (page === "archive") {
      archiveRows = await loadCsv("data/archive.csv");
      setupArchiveFilters(archiveRows);
      renderArchive(archiveRows);
    } else if (page === "education") {
      educationRows = await loadCsv("data/education.csv");
      setupEducationFilters(educationRows);
      renderEducation(educationRows);
    } else if (page === "people") {
      renderPeople(await loadCsv("data/people.csv"));
    }
  } catch (error) {
    console.error(error);
    detailList.innerHTML = `<p class="meta">${copy.loadError}</p>`;
  }
}

setupMenu();
setupArchiveResourceLinks();
init();
