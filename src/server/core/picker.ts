import { DomainError } from "./errors.ts";

/** Native folder chooser. macOS only; elsewhere the user types the path. Null = cancelled. */
export async function pickDirectory(): Promise<string | null> {
  if (Deno.build.os !== "darwin") {
    throw new DomainError(
      "The folder picker is only available on macOS. Type the path instead.",
      501,
    );
  }
  const out = await new Deno.Command("osascript", {
    args: ["-e", 'POSIX path of (choose folder with prompt "Choose a project folder")'],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) return null; // user cancelled
  const path = new TextDecoder().decode(out.stdout).trim().replace(/\/$/, "");
  return path || null;
}
