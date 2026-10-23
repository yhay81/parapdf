import type { ComponentProps, ReactNode } from "react";

/*
 * The demo's line icons, drawn for it on a 24-unit grid and stroked in the
 * current color, so that they follow the text color of their button.
 */
const paths = {
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.35-4.35" />
    </>
  ),
  chevronUp: <path d="m6.5 14.5 5.5-5.5 5.5 5.5" />,
  chevronDown: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  chevronRight: <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />,
  back: <path d="M19.5 12H5m6-6.5L4.5 12l6.5 6.5" />,
  forward: <path d="M4.5 12H19m-6-6.5 6.5 6.5-6.5 6.5" />,
  firstPage: <path d="M5.5 4.5h13M12 20V9.5M7.5 14 12 9.5l4.5 4.5" />,
  lastPage: <path d="M5.5 19.5h13M12 4v10.5M7.5 10l4.5 4.5 4.5-4.5" />,
  minus: <path d="M5.5 12h13" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  close: <path d="m6.5 6.5 11 11m0-11-11 11" />,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="18.5" cy="12" r="1" />
    </>
  ),
  file: (
    <>
      <path d="M13.5 3.5h-6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-10z" />
      <path d="M13.5 3.5v5h5" />
    </>
  ),
  open: (
    <>
      <path d="M13.5 3.5h-6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-10z" />
      <path d="M13.5 3.5v5h5" />
      <path d="M12 17.5V12m-2.5 2.5L12 12l2.5 2.5" />
    </>
  ),
  download: <path d="M12 4v11.5M7 10.5l5 5 5-5M5 20h14" />,
  print: (
    <>
      <path d="M7 8V4.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1V8" />
      <path d="M7 17H5.5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H17" />
      <rect x="7" y="13.5" width="10" height="7" rx="1" />
    </>
  ),
  rotateCw: (
    <>
      <path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5" />
      <path d="M20 3.5v5h-5" />
    </>
  ),
  rotateCcw: (
    <>
      <path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.5" />
      <path d="M4 3.5v5h5" />
    </>
  ),
  pointer: <path d="M5 5 19 10.5l-6.25 2.25L10.5 19z" />,
  hand: (
    <>
      <path d="M7.5 12.5V6.75a1.75 1.75 0 0 1 3.5 0V11" />
      <path d="M11 10.5V4.75a1.75 1.75 0 0 1 3.5 0V11" />
      <path d="M14.5 10.75v-4.5a1.75 1.75 0 0 1 3.5 0V12" />
      <path d="M18 9.25a1.75 1.75 0 0 1 3.5 0V14a7 7 0 0 1-7 7h-1.6a6 6 0 0 1-4.5-2.05l-3.6-4.1a1.75 1.75 0 0 1 2.65-2.3l2.05 2.2" />
    </>
  ),
  annotate: (
    <>
      <path d="M11 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13" />
      <path d="M17.9 3.6a1.9 1.9 0 0 1 2.7 2.7L13 13.9l-3.6.9.9-3.6z" />
    </>
  ),
  highlight: (
    <>
      <path d="m17.2 3.2 3.6 3.6-8 8-3.6-3.6z" />
      <path d="M9.2 11.2 7 15.5l1.5 1.5 4.3-2.2" />
      <path d="M4 20.5h8" />
    </>
  ),
  text: <path d="M5.5 7.5v-2h13v2M12 5.5v13M9 18.5h6" />,
  draw: (
    <>
      <path d="M15.6 4.4a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
      <path d="m13.5 6.5 3 3" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="9.5" r="1.75" />
      <path d="m20.5 15-4.5-4.5-10 9" />
    </>
  ),
  signature: (
    <>
      <path d="M4 16.5c1.5-3.2 3-8 5.2-8 1.6 0 .9 4.6-1.2 7.6 2-2.4 3.6-3.6 4.6-3.6 1.4 0 .4 2.5 1.6 2.5.9 0 1.7-.8 2.8-1.6" />
      <path d="M4 20h16" />
    </>
  ),
  undo: (
    <>
      <path d="M9 13.5 4.5 9 9 4.5" />
      <path d="M4.5 9H15a4.5 4.5 0 0 1 0 9h-3.5" />
    </>
  ),
  redo: (
    <>
      <path d="m15 13.5 4.5-4.5L15 4.5" />
      <path d="M19.5 9H9a4.5 4.5 0 0 0 0 9h3.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
      <path d="m6.5 7 .85 11.6a2 2 0 0 0 2 1.9h5.3a2 2 0 0 0 2-1.9L17.5 7" />
      <path d="M10 11v5.5M14 11v5.5" />
    </>
  ),
  pages: (
    <>
      <rect x="4.5" y="3.5" width="6" height="7.5" rx="1.25" />
      <rect x="13.5" y="3.5" width="6" height="7.5" rx="1.25" />
      <rect x="4.5" y="13" width="6" height="7.5" rx="1.25" />
      <rect x="13.5" y="13" width="6" height="7.5" rx="1.25" />
    </>
  ),
  outline: <path d="M4.5 6h.01M8.5 6h11M8.5 12h.01M12.5 12h7M8.5 18h.01M12.5 18h7" />,
  layers: (
    <>
      <path d="M12 3.5 20.5 8 12 12.5 3.5 8z" />
      <path d="m3.5 12.25 8.5 4.5 8.5-4.5" />
      <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
    </>
  ),
  attachment: (
    <path d="m19.5 11.5-7.8 7.8a4.6 4.6 0 0 1-6.5-6.5l8.3-8.3a3.1 3.1 0 0 1 4.4 4.4l-8.3 8.3a1.55 1.55 0 0 1-2.2-2.2l7.6-7.6" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.75h.01" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V13M12 16.25h.01" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5v-3a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6m0-6-9 9" />
      <path d="M18.5 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2h4" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.5C10.4 5 8 4.5 4 4.5v14c4 0 6.4.5 8 2 1.6-1.5 4-2 8-2v-14c-4 0-6.4.5-8 2z" />
      <path d="M12 6.5v14" />
    </>
  ),
  code: <path d="m8.5 7.5-5 4.5 5 4.5m7-9 5 4.5-5 4.5M13.5 5l-3 14" />,
  scrollVertical: (
    <>
      <rect x="7" y="2.5" width="10" height="8.5" rx="1.5" />
      <rect x="7" y="13" width="10" height="8.5" rx="1.5" />
    </>
  ),
  scrollHorizontal: (
    <>
      <rect x="2.5" y="7" width="8.5" height="10" rx="1.5" />
      <rect x="13" y="7" width="8.5" height="10" rx="1.5" />
    </>
  ),
  scrollWrapped: (
    <>
      <rect x="3" y="3" width="7.5" height="8" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="8" rx="1.5" />
      <rect x="3" y="13" width="7.5" height="8" rx="1.5" />
    </>
  ),
  scrollPage: (
    <>
      <rect x="7" y="3.5" width="10" height="17" rx="1.75" />
      <path d="m4.5 10-2 2 2 2m15-4 2 2-2 2" />
    </>
  ),
  spreadNone: <rect x="7.5" y="3.5" width="9" height="17" rx="1.75" />,
  spreadOdd: (
    <>
      <rect x="2.5" y="4.5" width="9" height="15" rx="1.5" />
      <rect x="12.5" y="4.5" width="9" height="15" rx="1.5" />
    </>
  ),
  spreadEven: (
    <>
      <rect x="2.5" y="4.5" width="9" height="15" rx="1.5" strokeDasharray="2 2.25" />
      <rect x="12.5" y="4.5" width="9" height="15" rx="1.5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

/** An icon beside or instead of text; decorative, so assistive technology skips it. */
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="demo-svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/**
 * A toolbar button that shows an icon, and its label too with `text`. The
 * label names it and is its tooltip, with the keyboard shortcut if any.
 */
export function IconButton({
  icon,
  label,
  shortcut,
  text,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children"> & {
  icon: IconName;
  label: string;
  shortcut?: string;
  text?: string;
}) {
  return (
    <button
      type="button"
      className={className ? `demo-button ${className}` : "demo-button"}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      {...props}
    >
      <Icon name={icon} />
      {text ? <span className="demo-button-text">{text}</span> : null}
    </button>
  );
}

/** How the platform writes its shortcuts: ⌘ on Apple's, Ctrl on the others. */
export const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
