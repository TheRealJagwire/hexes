// @ts-types="@types/d3-selection"
import { select } from "d3-selection";
// @ts-types="@types/d3-zoom"
import { zoom, type ZoomBehavior, zoomIdentity, type ZoomTransform } from "d3-zoom";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Status } from "../../shared/constants.ts";
import { type Cell, hexLayout, toPixel } from "../../shared/hexmap.ts";
import type { GraphNode, ProjectGraph } from "../../shared/views.ts";
import { api } from "../lib/api.ts";
import { relativeTime } from "../lib/format.ts";
import { Link, navigate } from "../lib/router.tsx";
import { useResource } from "../lib/use-resource.ts";
import { StatusPill } from "../components/Bits.tsx";
import { ErrorState, LoadingState } from "../components/Layout.tsx";
import { ProjectHeader } from "./Project.tsx";

/** Centre to corner, and the gap left between neighbouring cells. */
const SIZE = 28;
const GAP = 2;
const TOOLTIP_OFFSET = 12;
/** Room left above the map for the Back and Fit buttons. */
const CONTROLS_HEIGHT = 64;
/** Link lines stop this far from each centre, at about the cell's edge. */
const LINE_INSET = SIZE * 0.8;

/** Each status's colour tokens: [ink, fill], the same pair its pill uses. */
const COLOURS: Record<Status, [string, string]> = {
  ready: ["--ready", "--ready-bg"],
  blessed: ["--blessed", "--blessed-bg"],
  in_progress: ["--accent", "--accent-bg"],
  verified: ["--verified", "--verified-bg"],
  blocked: ["--blocked", "--blocked-bg"],
  done: ["--muted", "--line-soft"],
  answered: ["--muted", "--line-soft"],
  pull_requested: ["--accent", "--accent-bg"],
  merged: ["--verified", "--verified-bg"],
  closed: ["--muted", "--line-soft"],
};

const KIND_LABELS: Record<string, string> = {
  "core.project": "P",
  "core.design": "D",
  "core.spec": "Sp",
  "core.decision": "Dec",
  "core.question": "Q",
  "core.epic": "E",
  "core.story": "St",
  "core.substory": "Sub",
  "core.bug": "B",
  "core.gate": "G",
  "core.pull_request": "PR",
};

/** The short label drawn in a cell; custom kinds use the start of their qualifier. */
export function kindLabel(kind: string): string {
  const known = KIND_LABELS[kind];
  if (known) return known;
  const q = kind.split(".").pop() ?? kind;
  return q.charAt(0).toUpperCase() + q.slice(1, 2);
}

/** The corners of a pointy-top cell, less half the gap so neighbours do not touch. */
const CORNERS = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return `${((SIZE - GAP / 2) * Math.cos(a)).toFixed(2)},${
    ((SIZE - GAP / 2) * Math.sin(a)).toFixed(2)
  }`;
}).join(" ");

interface Placed {
  node: GraphNode;
  x: number;
  y: number;
}

interface Hover {
  id: string;
  /** Where to anchor the tooltip, relative to the map's box. */
  x: number;
  y: number;
}

export function HexMapScreen({ id }: { id: string }) {
  const res = useResource(() => api.projectGraph(id), [id]);
  const title = res.status === "ready" ? res.data.nodes[0]?.title : undefined;
  return (
    <div class="flex h-screen flex-col bg-bg text-ink">
      <ProjectHeader projectId={id} {...(title ? { title } : {})} />
      {res.status === "ready"
        ? <HexMap graph={res.data} />
        : (
          <main class="mx-auto w-full max-w-[1040px] px-8">
            {res.status === "loading" ? <LoadingState /> : (
              <ErrorState
                message={res.error}
                action={<Link href={`/p/${id}`} class="btn">Back to the project</Link>}
              />
            )}
          </main>
        )}
    </div>
  );
}

function HexMap({ graph }: { graph: ProjectGraph }) {
  const boxRef = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [hover, setHover] = useState<Hover | null>(null);

  const cells = useMemo(() => {
    const layout = hexLayout(graph);
    return graph.nodes.map((node): Placed => {
      const { x, y } = toPixel(layout.get(node.id) as Cell, SIZE);
      return { node, x, y };
    });
  }, [graph]);
  const byId = useMemo(() => new Map(cells.map((c) => [c.node.id, c])), [cells]);
  const links = useMemo(() => {
    const deps = new Map<string, string[]>();
    const dependents = new Map<string, string[]>();
    for (const { from, to } of graph.edges) {
      deps.set(from, [...deps.get(from) ?? [], to]);
      dependents.set(to, [...dependents.get(to) ?? [], from]);
    }
    return { deps, dependents };
  }, [graph]);

  const fit = () => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z || !cells.length) return;
    const xs = cells.map((c) => c.x);
    const ys = cells.map((c) => c.y);
    const [x0, x1] = [Math.min(...xs) - SIZE, Math.max(...xs) + SIZE];
    const [y0, y1] = [Math.min(...ys) - SIZE, Math.max(...ys) + SIZE];
    // Frame the map in the space between the buttons above and the legend below.
    const { width, height: full } = svg.getBoundingClientRect();
    const legend = boxRef.current?.querySelector("aside")?.getBoundingClientRect().height ?? 0;
    const top = CONTROLS_HEIGHT;
    const height = Math.max(full / 3, full - top - legend - 16);
    const k = Math.min(2, 0.92 * Math.min(width / (x1 - x0), height / (y1 - y0)));
    const t = zoomIdentity.translate(width / 2, top + height / 2).scale(k).translate(
      -(x0 + x1) / 2,
      -(y0 + y1) / 2,
    );
    select(svg).call(z.transform, t);
  };

  // Pan and zoom belong to d3; the cells themselves are rendered by Preact.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (e: { transform: ZoomTransform }) => {
        setTransform(e.transform);
        setHover(null);
      });
    zoomRef.current = z;
    select(svg).call(z);
    fit();
    return () => {
      select(svg).on(".zoom", null);
    };
  }, []);

  const hovered = hover ? byId.get(hover.id) : undefined;
  const related = useMemo(() => {
    if (!hover) return null;
    return new Set([
      hover.id,
      ...links.deps.get(hover.id) ?? [],
      ...links.dependents.get(hover.id) ?? [],
    ]);
  }, [hover, links]);

  const anchorAt = (id: string, clientX: number, clientY: number) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (box) setHover({ id, x: clientX - box.left, y: clientY - box.top });
  };
  const anchorOnCell = (id: string, el: Element) => {
    const r = el.getBoundingClientRect();
    anchorAt(id, r.right, r.top + r.height / 2);
  };

  return (
    <main ref={boxRef} class="relative min-h-0 flex-1 overflow-hidden">
      <svg
        ref={svgRef}
        class="block h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="group"
        aria-label={`Hex map: ${cells.length} hexes`}
      >
        <g transform={transform.toString()}>
          {cells.map(({ node, x, y }) => {
            const [ink, fill] = COLOURS[node.status] ?? COLOURS.blocked;
            const dim = related && !related.has(node.id);
            return (
              <g
                key={node.id}
                transform={`translate(${x.toFixed(2)},${y.toFixed(2)})`}
                tabIndex={0}
                role="link"
                aria-label={`${node.title}, ${node.kind}, ${node.status}`}
                class="cursor-pointer outline-none"
                style={{ opacity: dim ? 0.25 : 1, transition: "opacity 120ms" }}
                onPointerEnter={(e) => anchorAt(node.id, e.clientX, e.clientY)}
                onPointerMove={(e) => anchorAt(node.id, e.clientX, e.clientY)}
                onPointerLeave={() => setHover(null)}
                onFocus={(e) => anchorOnCell(node.id, e.currentTarget)}
                onBlur={() => setHover(null)}
                onClick={() => navigate(`/h/${node.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") navigate(`/h/${node.id}`);
                  if (e.key === "Escape") setHover(null);
                }}
              >
                <polygon
                  points={CORNERS}
                  style={{
                    fill: `var(${fill})`,
                    stroke: `var(${ink})`,
                    strokeWidth: node.id === hover?.id ? 3 : 1.25,
                  }}
                />
                <text
                  text-anchor="middle"
                  dominant-baseline="central"
                  class="pointer-events-none font-mono text-[11px] font-semibold"
                  style={{ fill: `var(${ink})` }}
                >
                  {kindLabel(node.kind)}
                </text>
              </g>
            );
          })}
          {hovered && related && (
            <g class="pointer-events-none" style={{ stroke: "var(--ink-2)" }}>
              {[...related].filter((r) => r !== hovered.node.id).map((r) => {
                const other = byId.get(r);
                if (!other) return null;
                const dependsOnIt = links.deps.get(hovered.node.id)?.includes(r);
                const dx = other.x - hovered.x;
                const dy = other.y - hovered.y;
                const len = Math.hypot(dx, dy);
                if (len <= 2 * LINE_INSET) return null;
                const [ux, uy] = [(dx / len) * LINE_INSET, (dy / len) * LINE_INSET];
                return (
                  <line
                    key={r}
                    x1={hovered.x + ux}
                    y1={hovered.y + uy}
                    x2={other.x - ux}
                    y2={other.y - uy}
                    stroke-width={1.5}
                    stroke-dasharray={dependsOnIt ? undefined : "4 3"}
                    opacity={0.8}
                  />
                );
              })}
            </g>
          )}
        </g>
      </svg>

      <div class="absolute right-4 top-4 flex gap-2">
        <Link href={`/p/${graph.projectId}`} class="btn">Back to project</Link>
        <button type="button" class="btn" onClick={fit}>Fit</button>
      </div>
      <Legend nodes={graph.nodes} />
      {hovered && hover && (
        <Tooltip
          node={hovered.node}
          x={hover.x}
          y={hover.y}
          box={boxRef.current}
          deps={links.deps.get(hovered.node.id)?.length ?? 0}
          dependents={links.dependents.get(hovered.node.id)?.length ?? 0}
        />
      )}
    </main>
  );
}

function Tooltip(
  { node, x, y, box, deps, dependents }: {
    node: GraphNode;
    x: number;
    y: number;
    box: HTMLElement | null;
    deps: number;
    dependents: number;
  },
) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + TOOLTIP_OFFSET, top: y + TOOLTIP_OFFSET });
  // Measure, then flip to the other side of the pointer if it would leave the map.
  useEffect(() => {
    const el = ref.current;
    if (!el || !box) return;
    const { width, height } = el.getBoundingClientRect();
    const W = box.clientWidth;
    const H = box.clientHeight;
    let left = x + TOOLTIP_OFFSET;
    let top = y + TOOLTIP_OFFSET;
    if (left + width > W - 8) left = Math.max(8, x - TOOLTIP_OFFSET - width);
    if (top + height > H - 8) top = Math.max(8, y - TOOLTIP_OFFSET - height);
    setPos({ left, top });
  }, [x, y, node.id, box]);
  return (
    <div
      ref={ref}
      role="tooltip"
      class="pointer-events-none absolute z-10 flex w-max max-w-[320px] flex-col gap-1.5 rounded-xl border border-line bg-panel px-4 py-3 text-sm shadow-lg"
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
    >
      <div class="flex flex-wrap items-center gap-2">
        <StatusPill status={node.status} />
        <span class="font-mono text-xs text-muted">{node.kind}</span>
      </div>
      <div class="font-semibold leading-snug text-ink">{node.title}</div>
      <div class="font-mono text-xs text-ink-2">{node.id}</div>
      {node.blurb && <p class="m-0 leading-snug text-ink-2">{node.blurb}</p>}
      <div class="font-mono text-xs text-muted">
        depends on {deps} · depended on by {dependents} · updated {relativeTime(node.updatedAt)}
      </div>
      {node.gitBranch && (
        <div class="break-all font-mono text-xs text-muted">branch {node.gitBranch}</div>
      )}
    </div>
  );
}

function Legend({ nodes }: { nodes: GraphNode[] }) {
  const statuses = [...new Set(nodes.map((n) => n.status))];
  const kinds = [...new Set(nodes.map((n) => n.kind))];
  return (
    <aside
      aria-label="Legend"
      class="absolute bottom-4 left-4 flex max-w-[calc(100%-32px)] flex-col gap-2 rounded-xl border border-line bg-panel/95 px-4 py-3 text-xs"
    >
      <div class="flex flex-wrap gap-x-3 gap-y-1.5">
        {statuses.map((s) => {
          const [ink, fill] = COLOURS[s] ?? COLOURS.blocked;
          return (
            <span key={s} class="inline-flex items-center gap-1.5 text-ink-2">
              <span
                class="inline-block h-3 w-3 rounded-sm border"
                style={{ background: `var(${fill})`, borderColor: `var(${ink})` }}
              />
              {s.replace("_", " ")}
            </span>
          );
        })}
      </div>
      <div class="flex flex-wrap gap-x-3 gap-y-1 font-mono text-muted">
        {kinds.map((k) => (
          <span key={k}>
            <b class="text-ink-2">{kindLabel(k)}</b> {k.replace(/^core\./, "")}
          </span>
        ))}
      </div>
      <div class="text-muted">
        {nodes.length}{" "}
        hexes · hover for details, click to open · solid line: depends on, dashed: depended on by
      </div>
    </aside>
  );
}
