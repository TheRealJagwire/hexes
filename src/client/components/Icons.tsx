import type { ComponentChildren } from "preact";

interface IconProps {
  size?: number;
  class?: string;
}

function Svg(
  { size = 16, width = 2, children, class: cls }: IconProps & {
    width?: number;
    children: ComponentChildren;
  },
) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={width}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cls}
    >
      {children}
    </svg>
  );
}

export const Plus = (p: IconProps & { width?: number }) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const Minus = (p: IconProps) => (
  <Svg {...p} width={2.2}>
    <path d="M5 12h14" />
  </Svg>
);
export const Close = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const ChevronRight = (p: IconProps) => (
  <Svg {...p} width={2.2}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
export const ChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);
export const Search = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Svg>
);
export const Copy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </Svg>
);
export const Check = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);
export const ArrowUpRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 17L17 7M9 7h8v8" />
  </Svg>
);
export const Sun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);
export const Moon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Svg>
);
export const Folder = (p: IconProps) => (
  <Svg {...p} width={1.8}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);
export const HexPlus = (p: IconProps) => (
  <Svg {...p} width={1.8}>
    <path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z" />
    <path d="M12 8.5v7M8.5 12h7" />
  </Svg>
);

/** Three cells of a hex grid. */
export const HexGrid = (p: IconProps) => (
  <Svg {...p} width={1.8}>
    <path d="M12 2.5l3.5 2v4L12 10.5l-3.5-2v-4zM8 11.5l3.5 2v4L8 19.5l-3.5-2v-4zM16 11.5l3.5 2v4l-3.5 2-3.5-2v-4z" />
  </Svg>
);

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <path
        d="M14 2 L24.4 8 L24.4 20 L14 26 L3.6 20 L3.6 8 Z"
        fill="none"
        stroke="var(--accent)"
        stroke-width="2.2"
        stroke-linejoin="round"
      />
      <path d="M14 9 L18.3 11.5 L18.3 16.5 L14 19 L9.7 16.5 L9.7 11.5 Z" fill="var(--accent)" />
    </svg>
  );
}
