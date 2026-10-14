import { render } from "preact";
import { App } from "./components/App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
render(<App />, root);
