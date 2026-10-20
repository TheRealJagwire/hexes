import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { type Match, searchHexes } from "../../shared/search.ts";
import { api } from "../lib/api.ts";
import { navigate } from "../lib/router.tsx";
import { useResource } from "../lib/use-resource.ts";
import { StatusPill } from "./Bits.tsx";
import { Search } from "./Icons.tsx";

const LIMIT = 8;

/** Whether a key press belongs to something the person is typing in. */
function typingIn(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/** A title with the matched word starts in bold. */
function Highlighted({ title, ranges }: { title: string; ranges: Match["ranges"] }) {
  const parts = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(title.slice(at, start));
    parts.push(
      <mark key={start} class="bg-transparent font-bold text-ink">{title.slice(start, end)}</mark>,
    );
    at = end;
  }
  parts.push(title.slice(at));
  return <>{parts}</>;
}

/**
 * Finds a hex in the project as you type: every typed word must start a word of the title, or the
 * text must start the id. `/` focuses it from anywhere on the page.
 */
export function HexSearch({ projectId, class: cls = "" }: { projectId: string; class?: string }) {
  const graph = useResource(() => api.projectGraph(projectId), [projectId]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);

  const nodes = graph.status === "ready" ? graph.data.nodes : [];
  const matches = useMemo(() => searchHexes(nodes, text, LIMIT), [nodes, text]);
  const open = focused && !dismissed && text.trim() !== "";
  const listId = `hex-search-${projectId}`;
  const optionId = (i: number) => `${listId}-${i}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || typingIn(e.target)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    listRef.current?.querySelector(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({
      block: "nearest",
    });
  }, [active, open]);

  const choose = (m: Match | undefined) => {
    if (!m) return;
    setText("");
    setActive(0);
    inputRef.current?.blur();
    navigate(`/h/${m.node.id}`);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setDismissed(false);
      if (!matches.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open) choose(matches[active] ?? matches[0]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (open) setDismissed(true);
      else setText("");
    }
  };

  return (
    <div class={`relative ${cls}`}>
      <label for={`${listId}-input`} class="sr-only">Search hexes</label>
      <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
        <Search size={16} />
      </span>
      <input
        ref={inputRef}
        id={`${listId}-input`}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches.length ? optionId(active) : undefined}
        autocomplete="off"
        spellcheck={false}
        placeholder="Search hexes  /"
        value={text}
        onInput={(e) => {
          setText(e.currentTarget.value);
          setActive(0);
          setDismissed(false);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        class="field h-10 pl-9 text-sm"
      />
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Matching hexes"
          class="absolute left-0 right-0 top-[calc(100%+6px)] z-20 m-0 flex max-h-[min(420px,70vh)] list-none flex-col gap-0.5 overflow-y-auto rounded-xl border border-line bg-panel p-1.5 shadow-lg sm:min-w-[420px]"
        >
          {matches.length === 0 && (
            <li class="px-3 py-2.5 text-sm text-muted">
              {graph.status === "ready" ? `No hexes match “${text.trim()}”` : "Loading hexes…"}
            </li>
          )}
          {matches.map((m, i) => (
            <li
              key={m.node.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              // Keep focus in the box, so blur doesn't close the list before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => choose(m)}
              class={`flex cursor-pointer flex-col gap-1 rounded-lg px-3 py-2 ${
                i === active ? "bg-panel2" : ""
              }`}
            >
              <span class="text-sm leading-snug text-ink-2">
                <Highlighted title={m.node.title} ranges={m.ranges} />
              </span>
              <span class="flex flex-wrap items-center gap-2">
                <StatusPill status={m.node.status} />
                <span class="font-mono text-xs text-muted">
                  {m.node.kind.replace(/^core\./, "")} · {m.node.id}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
