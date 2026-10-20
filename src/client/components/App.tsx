import { useEffect } from "preact/hooks";
import { api } from "../lib/api.ts";
import { liveStatus } from "../lib/live.ts";
import { Link, location, matchPath, navigate } from "../lib/router.tsx";
import { useResource } from "../lib/use-resource.ts";
import { ErrorState, LoadingState } from "./Layout.tsx";
import { CreateHex } from "../screens/CreateHex.tsx";
import { HexScreen } from "../screens/Hex.tsx";
import { ProjectScreen } from "../screens/Project.tsx";
import { HexMapScreen } from "../screens/HexMap.tsx";
import { DiffScreen } from "../screens/PullRequests.tsx";
import { Projects } from "../screens/Projects.tsx";
import { Welcome } from "../screens/Welcome.tsx";

/** `/`: first run → welcome; a selected project → its screen; otherwise the project list. */
function Start() {
  const res = useResource(() => api.state(), []);
  useEffect(() => {
    if (res.status !== "ready") return;
    const { dir, selectedProjectId } = res.data;
    navigate(!dir ? "/welcome" : selectedProjectId ? `/p/${selectedProjectId}` : "/projects", {
      replace: true,
    });
  }, [res.status]);
  if (res.status === "error") return <ErrorState message={res.error} />;
  return <LoadingState />;
}

function NotFound() {
  return (
    <ErrorState
      message="That page doesn't exist."
      action={<Link href="/" class="btn">Go home</Link>}
    />
  );
}

/** A small dot in the corner: green while updates stream in, amber while reconnecting. */
function LiveDot() {
  const status = liveStatus.value;
  if (status === "connecting") return null;
  const live = status === "live";
  return (
    <span
      role="status"
      title={live ? "Live: changes appear as they happen" : "Reconnecting to Studio…"}
      class={`fixed bottom-3 right-3 z-50 h-2.5 w-2.5 rounded-full ${
        live ? "bg-ready" : "animate-pulse bg-blocked"
      }`}
    />
  );
}

export function App() {
  return (
    <>
      <Routes />
      <LiveDot />
    </>
  );
}

function Routes() {
  const { path, search } = location.value;
  const query = new URLSearchParams(search);
  let m: Record<string, string> | null;
  if (path === "/") return <Start />;
  if (path === "/welcome") return <Welcome />;
  if (path === "/projects") return <Projects />;
  if ((m = matchPath("/p/:id", path))) return <ProjectScreen id={m.id as string} />;
  if ((m = matchPath("/p/:id/new", path))) {
    return <CreateHex projectId={m.id as string} emergedFrom={query.get("emergedFrom")} />;
  }
  if ((m = matchPath("/p/:id/map", path))) return <HexMapScreen id={m.id as string} />;
  if ((m = matchPath("/h/:id", path))) return <HexScreen id={m.id as string} />;
  if ((m = matchPath("/h/:id/diff/:pr", path))) {
    return <DiffScreen workId={m.id as string} prId={m.pr as string} />;
  }
  return <NotFound />;
}
