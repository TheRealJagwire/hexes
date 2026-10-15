import DOMPurify from "dompurify";
import { marked } from "marked";

// Descriptions come from files and agents, so the HTML is always sanitised before it is shown.
// Links open in a new tab and never leak the opener.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true, breaks: true });
  return DOMPurify.sanitize(html);
}
