import { FACT_KIND, type HexIndex } from "./graph.ts";

/**
 * The facts within `depth` hops of `from`, each with the shortest path of ids that reaches it
 * (`from` first, the fact last). Links are `dependsOn` taken in both directions, visited in id
 * order so the result is deterministic. The search never steps through a project, which every hex
 * depends on and would put every fact two hops from everything, nor through `studio.*` hexes.
 */
export function factsNear(idx: HexIndex, from: string, depth: number): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const paths = new Map<string, string[]>([[from, [from]]]);
  let frontier = [from];
  for (let hop = 1; hop <= depth && frontier.length; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      const hex = idx.byId.get(id);
      // The start may be a project; any other project is a dead end, never a way through.
      if (!hex || (id !== from && hex.kind === "core.project")) continue;
      const links = [
        ...(hex.dependsOn ?? []),
        ...(idx.dependents.get(id) ?? []).map((d) => d.id),
      ].sort();
      for (const link of links) {
        const other = idx.byId.get(link);
        if (!other || paths.has(link) || other.kind.startsWith("studio.")) continue;
        const path = [...paths.get(id)!, link];
        paths.set(link, path);
        if (other.kind === FACT_KIND) found.set(link, path);
        next.push(link);
      }
    }
    frontier = next.sort();
  }
  return found;
}
