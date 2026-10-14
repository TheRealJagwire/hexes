import { DomainError } from "./errors.ts";

const encoder = new TextEncoder();

export const MIN_HASH_LENGTH = 3;
const MAX_HASH_LENGTH = 64; // a full sha-256

/** First `length` hex chars of sha-256(title \n kind \n createdAtTimeInMs). */
export async function hashHex(
  title: string,
  kind: string,
  createdAt: number,
  length = MIN_HASH_LENGTH,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${title}\n${kind}\n${createdAt}`),
  );
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, length);
}

/**
 * Three hex chars allow only 4,096 ids per prefix, so collisions are real. When the id is
 * taken, the *new* hex's hash grows one digit at a time (3, 4, 5, …) until it is unique; the
 * older hex keeps its id. createdAt is untouched, so every id can still be recomputed as a
 * prefix of the hash of the stored title, kind and createdAt.
 */
export async function generateId(
  prefix: string,
  title: string,
  kind: string,
  createdAt: number,
  taken: ReadonlySet<string>,
): Promise<string> {
  for (let length = MIN_HASH_LENGTH; length <= MAX_HASH_LENGTH; length++) {
    const id = `hx-${prefix}-${await hashHex(title, kind, createdAt, length)}`;
    if (!taken.has(id)) return id;
  }
  throw new DomainError(`Could not find a free id under prefix "${prefix}"`, 409);
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
