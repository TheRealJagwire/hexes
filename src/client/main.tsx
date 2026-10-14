import { render } from "preact";
import { App } from "./components/App.tsx";
import { startLive } from "./lib/live.ts";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
startLive();
render(<App />, root);
