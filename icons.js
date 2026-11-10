// Inline SVG icons so there are no extra files or network requests.
const svg = (d) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;

export const icons = {
  play: svg('M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z'),
  pause: svg('M6 4h4v16H6zM14 4h4v16h-4z'),
  next: svg('M5 5.5v13a1 1 0 0 0 1.55.83L15 13.7V18a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v4.3L6.55 4.67A1 1 0 0 0 5 5.5z'),
  prev: svg('M19 5.5v13a1 1 0 0 1-1.55.83L9 13.7V18a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v4.3l8.45-5.63A1 1 0 0 1 19 5.5z'),
  shuffle: svg('M17 3l4 4-4 4V8h-2.6l-2.2 2.6-1.3-1.5L13.5 6H17V3zM3 6h4.5l9 11H17v-3l4 4-4 4v-3h-2.4L5.6 8H3V6zm0 10h2.6l2.2-2.6 1.3 1.5L6.5 18H3v-2z'),
  repeat: svg('M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z'),
  repeatOne: svg('M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z'),
  volume: svg('M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z'),
  volumeOff: svg('M3 9v6h4l5 5V4L7 9H3zm15.6 3l2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z'),
  mini: svg('M19 7h-8v6h8V7zm2-4H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H3V5h18v14z'),
  expand: svg('M4 4h7v2H6v5H4V4zm16 16h-7v-2h5v-5h2v7z'),
  close: svg('M18.3 5.7L12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z'),
  heart: svg('M16.5 3A5.5 5.5 0 0 0 12 5.3 5.5 5.5 0 0 0 7.5 3 5.5 5.5 0 0 0 2 8.5c0 3.8 3.4 6.9 8.6 11.5L12 21.3l1.4-1.3C18.6 15.4 22 12.3 22 8.5A5.5 5.5 0 0 0 16.5 3zm-4.4 15.6l-.1.1-.1-.1C7.1 14.2 4 11.4 4 8.5 4 6.5 5.5 5 7.5 5c1.5 0 3 1 3.6 2.4h1.9C13.5 6 15 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.9-3.1 5.7-7.9 10.1z'),
  heartFill: svg('M12 21.3l-1.4-1.3C5.4 15.4 2 12.3 2 8.5A5.5 5.5 0 0 1 7.5 3c1.7 0 3.4.8 4.5 2.1A6 6 0 0 1 16.5 3 5.5 5.5 0 0 1 22 8.5c0 3.8-3.4 6.9-8.6 11.5L12 21.3z'),
  plus: svg('M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z'),
  chevron: svg('M7.4 8.6L12 13.2l4.6-4.6L18 10l-6 6-6-6z'),
  sparkle: svg('M12 2l2.1 6.4L20.5 10.5 14.1 12.6 12 19l-2.1-6.4L3.5 10.5l6.4-2.1zM19 15l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z'),
  list: svg('M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h11v2H4v-2z'),
  minimize: svg('M5 11.25h14v1.5H5z'),
  maximize: svg('M6 6h12v12H6V6zm1.5 1.5v9h9v-9h-9z'),
  logout: svg('M16 17v-3H9v-4h7V7l5 5-5 5zM14 2a2 2 0 0 1 2 2v2h-2V4H5v16h9v-2h2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9z'),
};

/** Fills every [data-icon] element with its SVG. */
export function paintIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icons[el.dataset.icon] || ''; });
}
