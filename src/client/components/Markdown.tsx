import { useMemo } from "preact/hooks";
import { renderMarkdown } from "../lib/markdown.ts";

/** A hex description rendered as (sanitised) markdown. Styled by `.md` in app.css. */
export function Markdown({ text, class: cls = "" }: { text: string; class?: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div class={`md ${cls}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
