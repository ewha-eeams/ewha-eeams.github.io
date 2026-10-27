try {
  for (const link of document.querySelectorAll('a[href="#contact"]')) link.href = `${location.pathname}${location.search}#contact`;
  await import('./preview-detail.mjs');
}
catch (error) {
  const list = document.querySelector('#detail-list');
  const message = document.createElement('p'); message.className = 'meta'; message.textContent = error.message;
  const back = document.createElement('a'); back.href = new URL('index.html', import.meta.url).href; back.target = '_top'; back.textContent = '미리보기 목록으로 돌아가기';
  list.replaceChildren(message, back);
}
