import type { ReactNode } from "react";

/** Inline formatting: **bold**, _italic_, `code` and bare http(s) links. Renders React nodes only — never raw HTML. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|_[^_\s][^_]*_|https?:\/\/[^\s)<>]+)/g;
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const key = `${keyBase}-${i++}`;
    if (token.startsWith("**")) out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("_")) out.push(<em key={key}>{token.slice(1, -1)}</em>);
    else out.push(<a key={key} href={token} target="_blank" rel="noreferrer noopener">{token}</a>);
    last = index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) => line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** Small Markdown renderer for stored knowledge and blueprint text: headings, lists, tables, checkboxes, paragraphs. */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i++;
      continue;
    }
    const k = `b${key++}`;
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1]!.length + 1, 4);
      const content = inline(heading[2] ?? "", k);
      blocks.push(level === 2 ? <h2 key={k}>{content}</h2> : level === 3 ? <h3 key={k}>{content}</h3> : <h4 key={k}>{content}</h4>);
      i++;
    } else if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i] ?? "")) rows.push(cells(lines[i++] ?? ""));
      blocks.push(
        <table key={k}>
          <thead>
            <tr>{head.map((c, n) => <th key={n}>{inline(c, `${k}h${n}`)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>{row.map((c, n) => <td key={n}>{inline(c, `${k}r${r}c${n}`)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
    } else if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) items.push((lines[i++] ?? "").replace(/^\s*[-*]\s+/, ""));
      blocks.push(
        <ul key={k}>
          {items.map((item, n) => {
            const box = item.match(/^\[( |x)\]\s+(.*)$/i);
            return <li key={n}>{box ? <>{box[1] === " " ? "☐ " : "☑ "}{inline(box[2] ?? "", `${k}i${n}`)}</> : inline(item, `${k}i${n}`)}</li>;
          })}
        </ul>,
      );
    } else if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) items.push((lines[i++] ?? "").replace(/^\s*\d+\.\s+/, ""));
      blocks.push(<ol key={k}>{items.map((item, n) => <li key={n}>{inline(item, `${k}i${n}`)}</li>)}</ol>);
    } else {
      const para: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim() && !/^(#{1,4}\s|\s*[-*]\s+|\s*\d+\.\s+|\|)/.test(lines[i] ?? "")) para.push(lines[i++] ?? "");
      if (para.length === 0) para.push(lines[i++] ?? "");
      blocks.push(<p key={k}>{inline(para.join(" "), k)}</p>);
    }
  }
  return <div className="prose">{blocks}</div>;
}
