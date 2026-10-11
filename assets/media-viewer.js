const params = new URLSearchParams(window.location.search);
const src = params.get("src") || "";
const gallery = params.get("gallery") || "";
const label = params.get("label") || "Media";
const returnPage = params.get("from") === "education" ? "education" : "archive";
const recordId = /^[a-z0-9-]+$/i.test(params.get("record") || "") ? params.get("record") : "";

const title = document.querySelector("#media-title");
const frame = document.querySelector("#media-frame");
const download = document.querySelector("#media-download");
const back = document.querySelector("#media-back");
const menuToggle = document.querySelector(".menu-toggle");
const siteMenu = document.querySelector("#site-menu");

title.textContent = label;
download.textContent = "다운로드 / Download";
back.textContent = returnPage === "education"
  ? "← 교육 아카이브로 돌아가기"
  : "← 공연 아카이브로 돌아가기";
back.href = `${returnPage}.html${recordId ? `#${recordId}` : ""}`;
document.title = `${label} | EEAMS`;
document.querySelector("#media-section-label").textContent = returnPage === "education" ? "Education Media" : "Archive Media";

menuToggle?.addEventListener("click", () => {
  const isOpen = siteMenu.classList.toggle("is-open");
  menuToggle.setAttribute("aria-expanded", String(isOpen));
});

siteMenu?.addEventListener("click", (event) => {
  if (event.target.matches("a")) {
    siteMenu.classList.remove("is-open");
    menuToggle?.setAttribute("aria-expanded", "false");
  }
});

function safeMediaPath(path) {
  try {
    const base = new URL("assets/media/", document.baseURI);
    const url = new URL(path, document.baseURI);
    if (!path || url.origin !== base.origin || !url.pathname.startsWith(base.pathname) ||
        url.search || url.hash || !/\.(pdf|jpe?g|png|webp)$/i.test(url.pathname)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function safeGalleryBase(path) {
  try {
    const base = new URL("assets/media/", document.baseURI);
    const url = new URL(path, document.baseURI);
    if (!path || url.origin !== base.origin || !url.pathname.startsWith(base.pathname) ||
        url.search || url.hash || !/-photo$/i.test(url.pathname)) return "";
    return url.href;
  } catch {
    return "";
  }
}

const mediaPath = safeMediaPath(src);
const galleryBase = safeGalleryBase(gallery);

function showMediaError() {
  const message = document.createElement("p");
  message.className = "meta";
  message.textContent = "자료를 불러올 수 없습니다. / Media could not be loaded.";
  frame.replaceChildren(message);
  download.hidden = true;
}

async function loadMedia() {
  download.hidden = true;
  if (galleryBase) return loadGallery();
  if (!mediaPath) return showMediaError();
  try {
    const response = await fetch(mediaPath, { method: "HEAD", cache: "no-cache" });
    if (!response.ok || !/^(image\/|application\/pdf)/i.test(response.headers.get("content-type") || "")) {
      return showMediaError();
    }
    const isPdf = new URL(mediaPath).pathname.toLowerCase().endsWith(".pdf");
    const media = document.createElement(isPdf ? "iframe" : "img");
    media.src = mediaPath;
    if (isPdf) media.title = label;
    else {
      media.alt = label;
      media.addEventListener("error", showMediaError);
    }
    frame.replaceChildren(media);
    download.href = mediaPath;
    download.hidden = false;
  } catch {
    showMediaError();
  }
}

async function loadGallery() {
  const photos = [];
  for (let index = 1; index <= 20; index += 1) {
    const url = safeMediaPath(`${galleryBase}${index}.jpg`);
    if (!url) break;
    try {
      const response = await fetch(url, { method: "HEAD", cache: "no-cache" });
      if (!response.ok || !/^image\//i.test(response.headers.get("content-type") || "")) break;
      photos.push(url);
    } catch {
      break;
    }
  }

  if (!photos.length) return showMediaError();
  const galleryElement = document.createElement("div");
  galleryElement.className = "media-gallery";
  photos.forEach((url, index) => {
    const figure = document.createElement("figure");
    figure.className = "media-gallery-item";
    const image = document.createElement("img");
    image.src = url;
    image.alt = `${label} ${index + 1}`;
    image.loading = "lazy";
    const caption = document.createElement("figcaption");
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    const photoDownload = document.createElement("a");
    photoDownload.href = url;
    photoDownload.download = "";
    photoDownload.textContent = "다운로드 / Download";
    caption.append(number, photoDownload);
    figure.append(image, caption);
    galleryElement.append(figure);
  });
  frame.classList.add("media-gallery-frame");
  frame.replaceChildren(galleryElement);
}

loadMedia();
