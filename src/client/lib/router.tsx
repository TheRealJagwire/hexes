import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";

/** Minimal History-API router: one signal holds the current path + search. */
export const location = signal({
  path: globalThis.location?.pathname ?? "/",
  search: globalThis.location?.search ?? "",
});

function sync(): void {
  location.value = { path: globalThis.location.pathname, search: globalThis.location.search };
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  sync();
  globalThis.scrollTo?.(0, 0);
}

globalThis.addEventListener?.("popstate", sync);

/** `/p/:id` against `/p/hx-a-123` → `{ id: "hx-a-123" }`, or null when it does not match. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const seg = a[i] as string;
    const val = b[i] as string;
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(val);
    else if (seg !== val) return null;
  }
  return params;
}

interface LinkProps {
  href: string;
  class?: string;
  title?: string;
  "aria-label"?: string;
  onClick?: (e: MouseEvent) => void;
  children?: ComponentChildren;
}

/** An anchor that navigates client-side but keeps real-link behaviour (new tab, middle click). */
export function Link({ href, onClick, children, ...rest }: LinkProps) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (
          e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey
        ) {
          return;
        }
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
