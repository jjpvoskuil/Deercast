// Stroke icons used across the app (one set, so every screen matches).
const P = {
  pin: <><path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21z" /><circle cx="12" cy="10.5" r="2.2" /></>,
  chev: <path d="M6 9l6 6 6-6" />,
  locate: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  map: <><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" /></>,
  log: <><path d="M6 3h11a2 2 0 0 1 2 2v16H8a2 2 0 0 1-2-2V3z" /><path d="M6 17a2 2 0 0 1 2-2h11M10 7h6M10 11h4" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  minus: <path d="M6 12h12" />,
  tree: <><path d="M12 3l5 7h-3l4 6H6l4-6H7l5-7z" /><path d="M12 16v5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" />,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  gauge: <><path d="M4 15a8 8 0 1 1 16 0" /><path d="M12 15l4-5" /></>,
  therm: <path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z" />,
  wind: <path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7" />,
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
  ground: <><path d="M3 20l6-9 4 6 3-4 5 7z" /><circle cx="17" cy="6" r="2" /></>,
  bow: <><path d="M6 3c8 3 8 15 0 18" /><path d="M6 3v18" /><path d="M3 12h17M17 9l3 3-3 3" /></>,
  book: <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z" /><path d="M4 19a2 2 0 0 1 2-2h13" /></>,
  tools: <><path d="M14 6l4-4 4 4-4 4" /><path d="M18 2 9 11" /><path d="M3 21l6-6M7 13l4 4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16v4z" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></>,
};
export default function Icon({ name, size, className = "icon", ...rest }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" style={size ? { width: size, height: size } : undefined} {...rest}>{P[name]}</svg>;
}
