import { assertEquals } from "@std/assert";
import { cleanPickedPath, detectPickerPlatform, pickerCommand } from "../src/server/core/picker.ts";

Deno.test("detectPickerPlatform: by OS, and WSL by env or kernel release", () => {
  assertEquals(detectPickerPlatform({ os: "darwin", env: {}, osrelease: "" }), "mac");
  assertEquals(detectPickerPlatform({ os: "windows", env: {}, osrelease: "" }), "windows");
  assertEquals(
    detectPickerPlatform({ os: "linux", env: { WSL_DISTRO_NAME: "Ubuntu" }, osrelease: "" }),
    "wsl",
  );
  assertEquals(
    detectPickerPlatform({
      os: "linux",
      env: {},
      osrelease: "5.15.153.1-microsoft-standard-WSL2\n",
    }),
    "wsl",
  );
  assertEquals(
    detectPickerPlatform({ os: "linux", env: {}, osrelease: "4.4.0-19041-Microsoft" }),
    "wsl",
  );
  assertEquals(
    detectPickerPlatform({ os: "linux", env: {}, osrelease: "6.8.0-45-generic" }),
    "unsupported",
  );
  assertEquals(detectPickerPlatform({ os: "freebsd", env: {}, osrelease: "" }), "unsupported");
});

function decodePowerShell(b64: string): string {
  const bin = atob(b64);
  let s = "";
  for (let i = 0; i < bin.length; i += 2) {
    s += String.fromCharCode(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8));
  }
  return s;
}

Deno.test("pickerCommand: osascript on macOS", () => {
  assertEquals(pickerCommand("mac"), {
    cmd: "osascript",
    args: ["-e", 'POSIX path of (choose folder with prompt "Choose a project folder")'],
  });
});

Deno.test("pickerCommand: a STA PowerShell FolderBrowserDialog on Windows", () => {
  const c = pickerCommand("windows")!;
  assertEquals(c.cmd, "powershell.exe");
  assertEquals(c.args.slice(0, 4), ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand"]);
  const script = decodePowerShell(c.args[4] ?? "");
  for (
    const part of [
      "System.Windows.Forms.FolderBrowserDialog",
      "'Choose a project folder'",
      "ShowNewFolderButton = $true",
      "TopMost = $true",
      "ShowDialog($owner)",
      "SelectedPath",
    ]
  ) {
    assertEquals(script.includes(part), true, part);
  }
});

Deno.test("pickerCommand: none where unsupported", () => {
  assertEquals(pickerCommand("unsupported"), null);
});

Deno.test("cleanPickedPath: trims, drops one trailing separator, keeps roots", () => {
  assertEquals(cleanPickedPath("", "windows"), null);
  assertEquals(cleanPickedPath("  \r\n", "mac"), null);
  assertEquals(cleanPickedPath("C:\\Users\\me\\app\r\n", "windows"), "C:\\Users\\me\\app");
  assertEquals(cleanPickedPath("C:\\Users\\me\\app\\", "windows"), "C:\\Users\\me\\app");
  assertEquals(cleanPickedPath("C:\\", "windows"), "C:\\");
  assertEquals(cleanPickedPath("d:/", "windows"), "d:/");
  assertEquals(cleanPickedPath("\\\\server\\share\\app\\", "windows"), "\\\\server\\share\\app");
  assertEquals(
    cleanPickedPath("\\\\wsl.localhost\\Ubuntu\\home\\me", "windows"),
    "\\\\wsl.localhost\\Ubuntu\\home\\me",
  );
  assertEquals(cleanPickedPath("/Users/me/app/\n", "mac"), "/Users/me/app");
  assertEquals(cleanPickedPath("/", "mac"), "/");
});

Deno.test("pickerCommand: WSL runs the same Windows dialog through interop", () => {
  assertEquals(pickerCommand("wsl"), pickerCommand("windows"));
});

Deno.test("cleanPickedPath: wslpath output", () => {
  assertEquals(cleanPickedPath("/mnt/c/code/app\n", "wsl"), "/mnt/c/code/app");
  assertEquals(cleanPickedPath("/home/me/app/\n", "wsl"), "/home/me/app");
  assertEquals(cleanPickedPath("/\n", "wsl"), "/");
  assertEquals(cleanPickedPath("\n", "wsl"), null);
});
