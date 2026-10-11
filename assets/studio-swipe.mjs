export function swipeDirection(start, end, width) {
  const dx = end.x - start.x, dy = end.y - start.y;
  if (start.x < 28 || start.x > width - 28 || end.time - start.time > 800
    || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.8) return 0;
  return dx < 0 ? 1 : -1;
}
