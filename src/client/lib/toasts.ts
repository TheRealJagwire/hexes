import { signal } from "@preact/signals";

export type ToastKind = "success" | "failure" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  /** Milliseconds until it goes by itself; null keeps it until updated or closed. */
  ttl: number | null;
}

export interface ToastHandle {
  /** Changes the toast in place and restarts its timer. */
  update(patch: Partial<Omit<Toast, "id">>): void;
  close(): void;
}

/** Success toasts go after 4 s, failures after 8 s. */
export const TTL: Record<ToastKind, number> = { success: 4000, failure: 8000, info: 4000 };
export const MAX_TOASTS = 3;

interface Timers {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

/** The toasts on screen, newest last, with their timers. Hovering or focusing one pauses it. */
export class ToastStore {
  readonly items = signal<Toast[]>([]);
  private next = 1;
  private readonly timers = new Map<number, number>();
  private readonly paused = new Set<number>();

  constructor(
    private readonly clock: Timers = {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (id) => clearTimeout(id),
    },
  ) {}

  show(text: string, kind: ToastKind = "success", ttl: number | null = TTL[kind]): ToastHandle {
    const id = this.next++;
    let list = [...this.items.value, { id, kind, text, ttl }];
    while (list.length > MAX_TOASTS) {
      this.stop(list[0]!.id);
      list = list.slice(1);
    }
    this.items.value = list;
    this.arm(id);
    return {
      update: (patch) => {
        if (!this.items.value.some((t) => t.id === id)) return;
        this.items.value = this.items.value.map((t) => t.id === id ? { ...t, ...patch } : t);
        this.arm(id);
      },
      close: () => this.close(id),
    };
  }

  close(id: number): void {
    this.stop(id);
    this.paused.delete(id);
    this.items.value = this.items.value.filter((t) => t.id !== id);
  }

  pause(id: number): void {
    this.paused.add(id);
    this.stop(id);
  }

  /** Restarts the full timer: someone just read it. */
  resume(id: number): void {
    this.paused.delete(id);
    this.arm(id);
  }

  private arm(id: number): void {
    this.stop(id);
    const ttl = this.items.value.find((t) => t.id === id)?.ttl;
    if (ttl == null || this.paused.has(id)) return;
    this.timers.set(id, this.clock.set(() => this.close(id), ttl));
  }

  private stop(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) this.clock.clear(timer);
    this.timers.delete(id);
  }
}

export const toasts = new ToastStore();

/** "Blessed hx-…": a success toast for something the person just did. */
export function notify(text: string): ToastHandle {
  return toasts.show(text, "success");
}

/** A failure toast with the server's message; returns the message for inline errors too. */
export function notifyError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  toasts.show(message, "failure");
  return message;
}

const STATUS_VERB: Partial<Record<string, string>> = {
  published: "Published",
  blessed: "Blessed",
  answered: "Answered",
  done: "Marked done:",
  retired: "Retired",
  known: "Restored",
  closed: "Closed",
};

/** "Blessed hx-…", or "hx-… is now ready" for the rest. */
export function statusText(id: string, status: string): string {
  const verb = STATUS_VERB[status];
  return verb ? `${verb} ${id}` : `${id} is now ${status.replace("_", " ")}`;
}
