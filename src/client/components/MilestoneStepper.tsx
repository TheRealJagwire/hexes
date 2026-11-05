/**
 * A minimal, animated milestone track. Milestones before `current` are done, `current` is
 * highlighted with a halo, and a dark fill runs along the track up to it. Below `verticalBelow`
 * pixels of container width it turns vertical; labels that would overlap a neighbour drop to a
 * second row. Colours come from props as CSS values (theme variables work) and reach the classes
 * through `--ms-*` custom properties.
 */
import type { CSSProperties } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

export interface Milestone {
  /** Stable key; falls back to the label. */
  id?: string;
  label: string;
  /** A second, muted line under the label. */
  date?: string;
  /** 0–100 position along the track; omitted milestones are spaced evenly. */
  at?: number;
}

type Edge = "start" | "mid" | "end";
type State = "done" | "current" | "upcoming";

export interface MilestoneStepperProps<M extends Milestone> {
  milestones: readonly M[];
  /** Index of the current milestone: earlier ones are done, `length` is all done, -1 none. */
  current?: number;
  /** 0–100, overriding the fill that otherwise runs to the current milestone. */
  progress?: number | null;
  /** Makes milestones clickable. */
  onSelect?: (index: number, milestone: M) => void;
  /** Gently breathe the current milestone's halo. */
  pulse?: boolean;
  /** Container width in px below which the track turns vertical. */
  verticalBelow?: number;
  accent?: string;
  ink?: string;
  track?: string;
  muted?: string;
  hollow?: string;
  surface?: string;
  /** Main transition, in ms. */
  duration?: number;
  /** Extra attributes for each milestone's list item (data attributes, a class). */
  itemProps?: (milestone: M, index: number) => { class?: string; [attr: `data-${string}`]: string };
  class?: string;
  "aria-label"?: string;
}

const EASE = "ease-[cubic-bezier(.2,.8,.2,1)]";

function edgeOf(i: number, n: number): Edge {
  if (n === 1 || i === 0) return "start";
  if (i === n - 1) return "end";
  return "mid";
}

export function MilestoneStepper<M extends Milestone>({
  milestones,
  current = 0,
  progress = null,
  onSelect,
  pulse = false,
  verticalBelow = 560,
  accent = "#C6F432",
  ink = "#0A0A0A",
  track = "#EDEDED",
  muted = "#6B6B6B",
  hollow = "#C4C4C4",
  surface = "#FFFFFF",
  duration = 800,
  itemProps,
  class: klass,
  "aria-label": ariaLabel = "Milestones",
}: MilestoneStepperProps<M>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [width, setWidth] = useState(0);
  const [rows, setRows] = useState<number[]>([]);
  const [fontsTick, setFontsTick] = useState(0);

  const n = milestones.length;
  const cur = Math.round(current);
  const vertical = width > 0 && width < verticalBelow;
  const clickable = onSelect !== undefined;

  const even = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * 100);
  const pos = (i: number) => {
    const at = milestones[i]?.at;
    return typeof at === "number" ? Math.max(0, Math.min(100, at)) : even(i);
  };
  const at = vertical ? even : pos;

  let fill: number;
  if (progress !== null && !Number.isNaN(progress)) fill = Math.max(0, Math.min(100, progress));
  else if (cur >= n) fill = 100;
  else if (cur < 0 || n === 0) fill = 0;
  else fill = at(cur);

  // Track the container's width: it drives vertical mode and the label collision checks.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(e.contentRect.width));
    ro.observe(el);
    let live = true;
    void document.fonts?.ready.then(() => live && setFontsTick((t) => t + 1));
    return () => {
      live = false;
      ro.disconnect();
    };
  }, []);

  // Drop labels that would overlap a neighbour onto a second row.
  useLayoutEffect(() => {
    let next: number[];
    if (!width || vertical) next = milestones.map(() => 1);
    else {
      const ends = [-Infinity, -Infinity];
      const GAP = 14;
      next = milestones.map((_, i) => {
        const w = textRefs.current[i]?.scrollWidth ?? 0;
        const x = (pos(i) / 100) * width;
        const edge = edgeOf(i, n);
        const left = edge === "start" ? x : edge === "end" ? x - w : x - w / 2;
        const row = left >= ends[0]! + GAP ? 1 : left >= ends[1]! + GAP ? 2 : 1;
        ends[row - 1] = left + w;
        return row;
      });
    }
    if (next.join() !== rows.join()) setRows(next);
  }, [width, vertical, milestones, fontsTick]);

  const twoRows = !vertical && rows.includes(2);
  const style: CSSProperties = {
    "--ms-accent": accent,
    "--ms-ink": ink,
    "--ms-track": track,
    "--ms-muted": muted,
    "--ms-hollow": hollow,
    "--ms-surface": surface,
    "--ms-dur": `${duration}ms`,
    ...(vertical ? { height: `${Math.max(n, 1) * 68}px` } : {}),
  };

  return (
    <div
      ref={rootRef}
      class={[
        "relative text-[var(--ms-ink)] transition-[height] duration-300 motion-reduce:transition-none",
        vertical ? "" : twoRows ? "h-[140px]" : "h-24",
        klass,
      ].filter(Boolean).join(" ")}
      style={style}
    >
      <div class={vertical ? "absolute inset-x-0 top-5 bottom-5" : "absolute inset-0"}>
        {/* track */}
        <div
          class={vertical
            ? "absolute left-2 top-0 bottom-0 w-1.5 rounded-full bg-[var(--ms-track)]"
            : "absolute left-0 right-0 top-2 h-1.5 rounded-full bg-[var(--ms-track)]"}
        />
        {/* fill */}
        <div
          class={[
            "absolute rounded-full bg-[var(--ms-ink)] duration-[var(--ms-dur)] motion-reduce:transition-none",
            EASE,
            vertical
              ? "left-2 top-0 w-1.5 transition-[height]"
              : "left-0 top-2 h-1.5 transition-[width]",
          ].join(" ")}
          style={vertical ? { height: `${fill}%` } : { width: `${fill}%` }}
        />

        <ol class="m-0 list-none p-0" aria-label={ariaLabel}>
          {milestones.map((m, i) => {
            const state: State = i < cur ? "done" : i === cur ? "current" : "upcoming";
            const edge = edgeOf(i, n);
            const row2 = !vertical && rows[i] === 2;
            const { class: itemClass, ...itemAttrs } = itemProps?.(m, i) ?? {};
            return (
              <li
                key={m.id ?? m.label}
                {...itemAttrs}
                aria-current={state === "current" ? "step" : undefined}
                class={[
                  "absolute transition-[left,top,transform,translate] duration-[var(--ms-dur)] motion-reduce:transition-none",
                  EASE,
                  vertical
                    ? "left-0 -translate-y-1/2"
                    : edge === "mid"
                    ? "top-0 -translate-x-1/2"
                    : edge === "end"
                    ? "top-0 -translate-x-full"
                    : "top-0",
                  itemClass,
                ].filter(Boolean).join(" ")}
                style={vertical ? { top: `${at(i)}%` } : { left: `${at(i)}%` }}
              >
                <button
                  type="button"
                  tabIndex={clickable ? 0 : -1}
                  aria-disabled={clickable ? undefined : "true"}
                  onClick={clickable ? () => onSelect(i, m) : undefined}
                  class={[
                    "group flex appearance-none border-0 bg-transparent p-0 [font:inherit] text-[color:inherit] outline-none [-webkit-tap-highlight-color:transparent]",
                    clickable ? "cursor-pointer" : "cursor-default",
                    vertical
                      ? "flex-row items-center gap-[18px] text-left"
                      : edge === "start"
                      ? "flex-col items-start gap-[18px] text-left"
                      : edge === "end"
                      ? "flex-col items-end gap-[18px] text-right"
                      : "flex-col items-center gap-[18px] text-center",
                  ].join(" ")}
                >
                  <span
                    class={vertical
                      ? "relative flex w-[22px] items-center justify-center"
                      : "relative flex h-[22px] items-center justify-center"}
                  >
                    {/* halo */}
                    <span
                      aria-hidden="true"
                      class={[
                        "pointer-events-none absolute left-1/2 top-1/2 h-[46px] w-[46px] -translate-x-1/2 -translate-y-1/2 rounded-full",
                        "bg-[color:color-mix(in_srgb,var(--ms-accent)_35%,transparent)] transition-[opacity,transform,scale] duration-300 motion-reduce:transition-none",
                        state === "current" ? "opacity-100 scale-100" : "opacity-0 scale-50",
                        state === "current" && pulse ? "motion-safe:animate-pulse" : "",
                      ].join(" ")}
                    />
                    {/* dot */}
                    <span
                      aria-hidden="true"
                      class={[
                        "relative box-border rounded-full transition-all duration-300 motion-reduce:transition-none",
                        "group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-[6px] group-focus-visible:outline-[var(--ms-ink)]",
                        clickable ? "group-hover:scale-110" : "",
                        state === "done"
                          ? "h-[18px] w-[18px] bg-[var(--ms-ink)]"
                          : state === "current"
                          ? "h-[26px] w-[26px] bg-[var(--ms-accent)] shadow-[0_0_0_4px_var(--ms-ink)]"
                          : "h-[18px] w-[18px] bg-[var(--ms-surface)] shadow-[inset_0_0_0_2px_var(--ms-hollow)]",
                      ].join(" ")}
                    />
                  </span>
                  <span
                    ref={(el) => {
                      textRefs.current[i] = el;
                    }}
                    class={[
                      "flex flex-col whitespace-nowrap transition-[padding] duration-300 motion-reduce:transition-none",
                      row2 ? "pt-11" : "pt-0",
                    ].join(" ")}
                  >
                    <span class="text-sm font-semibold leading-[1.3]">{m.label}</span>
                    {m.date
                      ? (
                        <span class="text-[13px] leading-[1.4] text-[var(--ms-muted)]">
                          {m.date}
                        </span>
                      )
                      : null}
                    <span class="sr-only">
                      {state === "done" ? " (done)" : state === "current" ? " (current)" : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
