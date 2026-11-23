import { DomainError } from "./errors.ts";

/** Where the server runs, as far as the native folder chooser is concerned. */
export type PickerPlatform = "mac" | "windows" | "wsl" | "unsupported";

/** Which folder chooser to use. `osrelease` is /proc/sys/kernel/osrelease ("" if unread). */
export function detectPickerPlatform(
  { os, env, osrelease }: {
    os: string;
    env: Record<string, string | undefined>;
    osrelease: string;
  },
): PickerPlatform {
  if (os === "darwin") return "mac";
  if (os === "windows") return "windows";
  if (os === "linux" && (env.WSL_DISTRO_NAME || /microsoft/i.test(osrelease))) return "wsl";
  return "unsupported";
}

/**
 * The Windows dialog: a FolderBrowserDialog owned by a hidden TopMost form, so it opens in front
 * of the browser. Prints the chosen path as UTF-8 on OK and nothing on Cancel.
 */
const WINDOWS_SCRIPT = [
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "Add-Type -AssemblyName System.Windows.Forms",
  "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }",
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$dialog.Description = 'Choose a project folder'",
  "$dialog.ShowNewFolderButton = $true",
  "if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
  "$owner.Dispose()",
].join("\n");

/** PowerShell's -EncodedCommand: base64 of UTF-16LE, so no argument quoting can mangle it. */
function encodePowerShell(script: string): string {
  const bytes = new Uint8Array(script.length * 2);
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i);
    bytes[i * 2] = c & 0xff;
    bytes[i * 2 + 1] = c >> 8;
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** The command that shows the dialog, or null where there is none. */
export function pickerCommand(platform: PickerPlatform): { cmd: string; args: string[] } | null {
  switch (platform) {
    case "mac":
      return {
        cmd: "osascript",
        args: ["-e", 'POSIX path of (choose folder with prompt "Choose a project folder")'],
      };
    case "windows":
    case "wsl":
      return {
        cmd: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-STA",
          "-EncodedCommand",
          encodePowerShell(WINDOWS_SCRIPT),
        ],
      };
    case "unsupported":
      return null;
  }
}

/**
 * The dialog's output as a path: trimmed, with one trailing separator dropped unless it is a root
 * (`/`, `C:\`). Empty output (the person cancelled) is null. On Windows either separator counts.
 */
export function cleanPickedPath(stdout: string, platform: PickerPlatform): string | null {
  const path = stdout.trim();
  if (!path) return null;
  if (platform === "windows") {
    if (/^[A-Za-z]:[\\/]$/.test(path)) return path;
    return path.replace(/[\\/]$/, "");
  }
  if (path === "/") return path;
  return path.replace(/\/$/, "");
}

const NAMES: Record<PickerPlatform, string> = {
  mac: "macOS",
  windows: "Windows",
  wsl: "WSL",
  unsupported: "this system",
};

function broken(platform: PickerPlatform, why: string): DomainError {
  return new DomainError(
    `The folder picker failed on ${NAMES[platform]} (${why}). Type the path instead.`,
    501,
  );
}

async function readOsRelease(): Promise<string> {
  try {
    return await Deno.readTextFile("/proc/sys/kernel/osrelease");
  } catch {
    return "";
  }
}

/** Native folder chooser on macOS and Windows; elsewhere the user types the path. Null = cancelled. */
export async function pickDirectory(): Promise<string | null> {
  const platform = detectPickerPlatform({
    os: Deno.build.os,
    env: { WSL_DISTRO_NAME: Deno.env.get("WSL_DISTRO_NAME") },
    osrelease: Deno.build.os === "linux" ? await readOsRelease() : "",
  });
  const command = platform === "wsl" ? null : pickerCommand(platform);
  if (!command) {
    throw new DomainError(
      "The folder picker is only available on macOS and Windows. Type the path instead.",
      501,
    );
  }
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command(command.cmd, {
      args: command.args,
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch (e) {
    throw broken(
      platform,
      e instanceof Deno.errors.NotFound ? `${command.cmd} not found` : String(e),
    );
  }
  if (!out.success) {
    if (platform === "mac") return null; // osascript exits non-zero when the user cancels
    const err = new TextDecoder().decode(out.stderr).trim().split("\n")[0];
    throw broken(platform, err || `exit code ${out.code}`);
  }
  return cleanPickedPath(new TextDecoder().decode(out.stdout), platform);
}
