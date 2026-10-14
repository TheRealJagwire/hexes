import { DomainError } from "./errors.ts";

const encoder = new TextEncoder();

/** First 3 hex chars of sha-256(title \n kind \n createdAtTimeInMs). */
export async function hashHex(title: string, kind: string, createdAt: number): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${title}\n${kind}\n${createdAt}`),
  );
  const bytes = new Uint8Array(digest);
  return [...bytes.slice(0, 2)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 3);
}

export interface GeneratedId {
  id: string;
  /** May be bumped past the requested time to dodge a collision. */
  createdAtTimeInMs: number;
}

/**
 * 3 hex chars allow only 4,096 ids per prefix, so collisions are real. The hash is a pure
 * function of (title, kind, createdAt), so on collision we bump createdAt by 1ms and rehash.
 * The id therefore stays verifiable from the stored fields.
 */
export async function generateId(
  prefix: string,
  title: string,
  kind: string,
  createdAt: number,
  taken: ReadonlySet<string>,
): Promise<GeneratedId> {
  for (let i = 0; i < 8192; i++) {
    const t = createdAt + i;
    const id = `hx-${prefix}-${await hashHex(title, kind, t)}`;
    if (!taken.has(id)) return { id, createdAtTimeInMs: t };
  }
  throw new DomainError(`No free ids left under prefix "${prefix}" (4,096 max)`, 409);
}

const SKIP_WORDS = new Set(["the", "a", "an", "my", "our", "project"]);

/** "Hexes Studio" → "hexes". Unique among `taken` ("hexes2", "hexes3", …). */
export function derivePrefix(title: string, taken: ReadonlySet<string>): string {
  const words = title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const word = words.find((w) => !SKIP_WORDS.has(w)) ?? words[0] ?? "proj";
  const base = word.slice(0, 8);
  let prefix = base;
  for (let n = 2; taken.has(prefix); n++) prefix = `${base}${n}`;
  return prefix;
}
