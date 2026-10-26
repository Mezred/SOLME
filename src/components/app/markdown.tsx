import { Fragment, type ReactNode } from "react";

/** Minimal, safe Markdown renderer (headings, lists, bold, italic, code, tables-as-text). No raw HTML. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={k++} className="font-semibold text-fg">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k++} className="num rounded bg-ink-700 px-1 text-[0.9em]">{t.slice(1, -1)}</code>);
    else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={blocks.length} className={`${list.ordered ? "list-decimal" : "list-disc"} my-2 space-y-1 pl-5`}>
        {list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}
      </Tag>,
    );
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || num) {
      const ordered = Boolean(num);
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? num)![1]);
      continue;
    }
    flush();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) blocks.push(<p key={blocks.length} className={`mb-1 mt-3 font-semibold text-fg ${h[1].length <= 2 ? "text-base" : "text-sm"}`}>{inline(h[2])}</p>);
    else if (/^---+$/.test(line)) blocks.push(<hr key={blocks.length} className="my-3 border-line" />);
    else if (line.trim() === "") blocks.push(<Fragment key={blocks.length} />);
    else blocks.push(<p key={blocks.length} className="my-1.5">{inline(line)}</p>);
  }
  flush();
  return <div className="text-sm leading-relaxed text-fg-muted">{blocks}</div>;
}
