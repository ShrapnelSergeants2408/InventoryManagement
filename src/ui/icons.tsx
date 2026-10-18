// Line icons from the Stage 3 mockup sources (24×24, stroke = currentColor).

export const ICONS = {
  inventory: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  order: 'M3 4h2.5l2.2 11h10.6l2.2-8H6.4 M8 20a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0 M15 20a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0',
  scan: 'M4 8V5a1 1 0 0 1 1-1h3 M16 4h3a1 1 0 0 1 1 1v3 M20 16v3a1 1 0 0 1-1 1h-3 M8 20H5a1 1 0 0 1-1-1v-3 M7 12h10',
  count: 'M9 3h6v3H9z M9 4.5H6v16.5h12V4.5h-3 M9 13.5l2 2 4-4',
  labels: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2v2h-2z M18 18h2v2h-2z M18 14h2v2 M14 18h2v2',
  more: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  lock: 'M6 11h12v10H6z M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  unlock: 'M6 11h12v10H6z M8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2',
  short: 'M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z M12 7.5v5.5 M12 16.5v.01',
  low: 'M12 3.5L21.5 20h-19z M12 10v4.5 M12 17.5v.01',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chevDown: 'M6 9l6 6 6-6',
  chevRight: 'M9 6l6 6-6 6',
  chevLeft: 'M15 6l-6 6 6 6',
  search: 'M4 11a7 7 0 1 0 14 0a7 7 0 1 0 -14 0 M20 20l-4.2-4.2',
  close: 'M6 6l12 12 M18 6L6 18',
  filter: 'M4 5h16l-6 7.5V18l-4 2v-7.5z',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  note: 'M4 4h16v12H9l-5 4z M8 9h8 M8 12.5h5',
  pin: 'M12 21s-6.5-6-6.5-11.5a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21z M10 9.5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
  photo: 'M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M15 9.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0',
  print: 'M7 9V3h10v6 M7 17H3v-8h18v8h-4 M7 14h10v7H7z',
  light: 'M13 2L4 14h7l-1 8 9-12h-7z',
  keyboard: 'M3 6h18v12H3z M7 10h.01 M11 10h.01 M15 10h.01 M7 14h10',
  camoff: 'M3 7h4l2-3h6l2 3h4v13H3z M8.5 13a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0 M3 3l18 18',
  camera: 'M3 7h4l2-3h6l2 3h4v13H3z M8.5 13a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0',
  gallery: 'M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  retry: 'M20 12a8 8 0 1 1-2.4-5.7 M20 4v6h-6',
  clock: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M12 7v5l3.5 2',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  pencil: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
  chevUp: 'M6 15l6-6 6 6',
  reorder: 'M8 4v16 M4 8l4-4 4 4 M16 20V4 M12 16l4 4 4-4',
  truck: 'M2 6h12v10H2z M14 10h4l4 3.5V16h-8 M4 18.5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M15 18.5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
  folder: 'M3 6h6l2 2h10v11H3z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  help: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5V14 M12 17.5v.01',
  upload: 'M12 3v12 M7 8l5-5 5 5 M5 13v7h14v-7',
  info: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M12 11v5.5 M12 7.5v.01',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.8z',
  tools: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  backspace: 'M9 5h11v14H9l-6-7z M12 9l6 6 M18 9l-6 6',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, class: cls = 'ic', label }: { name: IconName; class?: string; label?: string }) {
  return (
    <svg class={cls} viewBox="0 0 24 24" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
      <path d={ICONS[name]} />
    </svg>
  );
}
