// The project's build, driven by Zuke. Run `deno run -A zuke.ts --list` to see every target;
// the `deno task` entries in deno.json (build, check, test, ci, …) are thin wrappers around it.
import { Build, run, target } from "@zuke/core";
import { $ } from "@zuke/core/shell";
import { DenoTasks } from "@zuke/deno";

/** Every .ts/.tsx file directly inside `dir`, for `deno check` (the shell does no globbing). */
async function tsFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && /\.tsx?$/.test(entry.name)) files.push(`${dir}/${entry.name}`);
  }
  return files.sort();
}

/** Runs the Gradle wrapper in android/, finding a JDK 17+ and the SDK where Homebrew puts them. */
async function gradle(...args: string[]): Promise<void> {
  const env: Record<string, string> = {};
  const studioJdk = "/Applications/Android Studio.app/Contents/jbr/Contents/Home";
  if (!Deno.env.get("JAVA_HOME") && await Deno.stat(studioJdk).then(() => true, () => false)) {
    env.JAVA_HOME = studioJdk;
  }
  const brewSdk = "/opt/homebrew/share/android-commandlinetools";
  if (!Deno.env.get("ANDROID_HOME") && await Deno.stat(brewSdk).then(() => true, () => false)) {
    env.ANDROID_HOME = brewSdk;
  }
  const out = await new Deno.Command("./gradlew", {
    args,
    cwd: "android",
    env,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!out.success) throw new Error(`gradlew ${args.join(" ")} failed`);
}

class HexesBuild extends Build {
  clean = target()
    .description("Delete generated assets in static/")
    .executes(async () => {
      for (const file of ["static/app.css", "static/client.js"]) {
        await Deno.remove(file).catch(() => {});
      }
    });

  css = target()
    .description("Build Tailwind CSS into static/app.css")
    .inputs("src/client", "deno.json")
    .outputs("static/app.css")
    .executes(async () => {
      await $`deno run -A npm:@tailwindcss/cli -i src/client/styles/app.css -o static/app.css --minify`;
    });

  bundle = target()
    .description("Bundle the Preact client into static/client.js")
    .inputs("src/client", "src/shared", "deno.json")
    .outputs("static/client.js")
    .executes(async () => {
      await $`deno bundle --platform=browser --minify -o static/client.js src/client/main.tsx`;
    });

  build = target()
    .description("Build everything the server serves from static/")
    .dependsOn(this.css, this.bundle)
    .executes(() => {});

  fmt = target()
    .description("Check formatting")
    .executes(() => DenoTasks.fmt((s) => s.check()));

  lint = target()
    .description("Lint sources")
    .executes(() => DenoTasks.lint());

  typecheck = target()
    .description("Type-check the server, MCP server, client, scripts and tests")
    .executes(async () => {
      const entrypoints = [
        "src/server/main.ts",
        "src/mcp/server.ts",
        "src/client/main.tsx",
        "zuke.ts",
        ...await tsFiles("scripts"),
        ...await tsFiles("tests"),
      ];
      await DenoTasks.check((s) => s.paths(...entrypoints));
    });

  check = target()
    .description("Formatting, lint and type checks")
    .dependsOn(this.fmt, this.lint, this.typecheck)
    .executes(() => {});

  test = target()
    .description("Run the test suite")
    .executes(() => DenoTasks.test((s) => s.allowAll()));

  ci = target()
    .description("Everything CI should gate on: check, test and build")
    .dependsOn(this.check, this.test, this.build)
    .executes(() => {});

  androidTest = target()
    .description("Run the Android app's unit tests (needs the Android SDK; not part of ci)")
    .executes(() => gradle(":app:testDebugUnitTest"));

  androidBuild = target()
    .description("Assemble the Android debug APK (needs the Android SDK; not part of ci)")
    .dependsOn(this.androidTest)
    .executes(() => gradle(":app:assembleDebug"));

  androidRelease = target()
    .description("Assemble the signed release APK (needs android/keystore.properties)")
    .dependsOn(this.androidTest)
    .executes(() => gradle(":app:assembleRelease"));

  default = target()
    .description("Same as build")
    .dependsOn(this.build)
    .executes(() => {});
}

await run(HexesBuild);
