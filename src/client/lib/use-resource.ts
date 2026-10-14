import { useCallback, useEffect, useState } from "preact/hooks";

export type Resource<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: T; reload: () => void };

/** Loads on mount and whenever `deps` change; `reload()` refetches without flashing "loading". */
export function useResource<T>(load: () => Promise<T>, deps: readonly unknown[]): Resource<T> {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setState({ data }),
      (e) => live && setState({ error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [...deps, tick]);

  if (state.error !== undefined) return { status: "error", error: state.error };
  if (state.data === undefined) return { status: "loading" };
  return { status: "ready", data: state.data, reload };
}
