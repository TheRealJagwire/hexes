import { type Toast, toasts } from "../lib/toasts.ts";
import { Close } from "./Icons.tsx";

const TONE: Record<Toast["kind"], string> = {
  success: "border-line-strong",
  info: "border-accent",
  failure: "border-blocked text-blocked",
};

function ToastCard({ toast }: { toast: Toast }) {
  return (
    <li
      class={`hx-toast pointer-events-auto flex items-start gap-3 rounded-xl border bg-panel px-4 py-3 text-sm leading-normal text-ink shadow-lg ${
        TONE[toast.kind]
      }`}
      onMouseEnter={() => toasts.pause(toast.id)}
      onMouseLeave={() => toasts.resume(toast.id)}
      onFocusIn={() => toasts.pause(toast.id)}
      onFocusOut={() => toasts.resume(toast.id)}
    >
      <span class="min-w-0 flex-1 break-words">{toast.text}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => toasts.close(toast.id)}
        class="-mr-1 inline-flex size-6 flex-none items-center justify-center rounded-md border-none bg-transparent text-muted hover:text-ink"
      >
        <Close size={14} />
      </button>
    </li>
  );
}

/** Bottom-right (bottom-centre on a phone); failures are announced at once, the rest politely. */
export function Toasts() {
  const items = toasts.items.value;
  const failures = items.filter((t) => t.kind === "failure");
  const others = items.filter((t) => t.kind !== "failure");
  const stack = "m-0 flex list-none flex-col gap-2 p-0";
  return (
    <div class="pointer-events-none fixed inset-x-3 bottom-8 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:items-end">
      <ul aria-live="polite" class={`${stack} w-full max-w-[380px]`}>
        {others.map((t) => <ToastCard key={t.id} toast={t} />)}
      </ul>
      <ul role="alert" aria-live="assertive" class={`${stack} w-full max-w-[380px]`}>
        {failures.map((t) => <ToastCard key={t.id} toast={t} />)}
      </ul>
    </div>
  );
}
