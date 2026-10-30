/** Stroked 24×24 outlines of the demo's toolbar icons. */
const PATHS = {
  back: "M19 12H5M11 6l-6 6 6 6",
  forward: "M5 12h14M13 6l6 6-6 6",
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
  minus: "M5 12h14",
  plus: "M5 12h14M12 5v14",
  fitWidth: "M4 5v14M20 5v14M8 12h8M10 9l-3 3 3 3M14 9l3 3-3 3",
  fitPage: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  hand: "M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7c-2.2 0-3.6-.8-4.8-2.4L3.4 15a1.5 1.5 0 0 1 2.4-1.8L8 15.5",
  rotateLeft: "M4 12a8 8 0 1 0 8-8c-2.5 0-4.5 1-6 2.5L4 9M4 4v5h5",
  rotateRight: "M20 12a8 8 0 1 1-8-8c2.5 0 4.5 1 6 2.5L20 9M20 4v5h-5",
  print:
    "M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  outline: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  thumbnails: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  attachments:
    "M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 7",
};

export type IconName = keyof typeof PATHS;

/** An icon beside or instead of a control's text, hidden from assistive technology. */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
