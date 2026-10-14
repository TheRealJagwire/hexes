import type { ComponentChildren } from "preact";
import { theme, toggleTheme } from "../lib/theme.ts";
import { Link } from "../lib/router.tsx";
import { Logo, Moon, Sun } from "./Icons.tsx";

export function ThemeToggle() {
  const light = theme.value === "light";
  const label = light ? "Switch to dark mode" : "Switch to light mode";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      class="inline-flex size-11 flex-none items-center justify-center rounded-[10px] border border-line-strong bg-transparent text-ink-2"
    >
      {light ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}

export function Brand({ asLink = true }: { asLink?: boolean }) {
  const inner = (
    <>
      <Logo />
      <span class="text-lg font-bold tracking-[-0.01em]">Hexes Studio</span>
    </>
  );
  return asLink
    ? (
      <Link
        href="/projects"
        aria-label="All projects"
        class="flex min-h-11 items-center gap-3 text-ink no-underline"
      >
        {inner}
      </Link>
    )
    : <div class="flex items-center gap-3">{inner}</div>;
}

export function Header(
  { children, compact = false }: { children?: ComponentChildren; compact?: boolean },
) {
  return (
    <header
      class={`flex flex-wrap items-center justify-between gap-4 border-b border-line px-8 ${
        compact ? "py-3.5" : "py-[18px]"
      }`}
    >
      {children}
    </header>
  );
}

/** Page frame: full-height column with a capped, centred main area. */
export function Page(
  { header, width = 1040, top = "pt-10", children }: {
    header: ComponentChildren;
    width?: 960 | 1040 | 1080;
    top?: string;
    children: ComponentChildren;
  },
) {
  const max = width === 960
    ? "max-w-[960px]"
    : width === 1080
    ? "max-w-[1080px]"
    : "max-w-[1040px]";
  return (
    <div class="flex min-h-screen flex-col bg-bg text-ink">
      {header}
      <main class={`mx-auto box-border flex w-full flex-1 flex-col gap-8 px-8 pb-16 ${top} ${max}`}>
        {children}
      </main>
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return <p role="status" class="py-16 text-center text-muted">{label}</p>;
}

export function ErrorState({ message, action }: { message: string; action?: ComponentChildren }) {
  return (
    <div role="alert" class="mx-auto my-16 flex max-w-lg flex-col items-center gap-4 text-center">
      <p class="m-0 text-lg font-semibold">Something went wrong</p>
      <p class="m-0 text-muted">{message}</p>
      {action}
    </div>
  );
}
