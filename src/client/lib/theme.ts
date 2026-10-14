import { signal } from "@preact/signals";

export type Theme = "dark" | "light";

function initial(): Theme {
  try {
    return localStorage.getItem("hexes-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export const theme = signal<Theme>(initial());

export function toggleTheme(): void {
  const next: Theme = theme.value === "light" ? "dark" : "light";
  theme.value = next;
  document.documentElement.classList.toggle("light", next === "light");
  try {
    localStorage.setItem("hexes-theme", next);
  } catch { /* private mode: theme just won't persist */ }
}
