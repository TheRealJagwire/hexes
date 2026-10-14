import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ApiFailure } from "./api.ts";
import { liveVersion } from "./live.ts";

export type Resource<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: T; reload: () => void };

const LIVE_RETRIES = 3;
const LIVE_RETRY_MS = 800;

/**
 * Loads on mount and whenever `deps` change. `reload()` and live updates from the server refetch
 * without flashing "loading". A live refetch that fails (say, the file is mid-write) keeps the
 * data on screen and retries a few times before showing the error.
 */
export function useResource<T>(load: () => Promise<T>, deps: readonly unknown[]): Resource<T> {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const hasData = useRef(false);
  hasData.current = state.data !== undefined;

  // Live changes trigger the same silent reload as `reload()`; the first value is not a change.
  useEffect(() => {
    let first = true;
    return liveVersion.subscribe(() => {
      if (first) first = false;
      else reload();
    });
  }, [reload]);

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const run = (attempt: number) =>
      load().then(
        (data) => live && setState({ data }),
        (e) => {
          if (!live) return;
          const retryable = hasData.current && attempt < LIVE_RETRIES &&
            !(e instanceof ApiFailure && e.status === 404);
          if (retryable) timer = setTimeout(() => run(attempt + 1), LIVE_RETRY_MS);
          else setState({ error: e instanceof Error ? e.message : String(e) });
        },
      );
    run(0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [...deps, tick]);

  if (state.error !== undefined) return { status: "error", error: state.error };
  if (state.data === undefined) return { status: "loading" };
  return { status: "ready", data: state.data, reload };
}
