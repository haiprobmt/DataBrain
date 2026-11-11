import type { ReactNode } from "react";
import { CodeBlock, MermaidDiagram } from "./rich-blocks";

const SAFE_HREF = /^(https?:\/\/|\/(?!\/)|#|mailto:)/i;

/**
 * Inline formatting: **bold**, _italic_, `code`, [text](url), bare links, and TODO / PLACEHOLDER markers.
 * Renders React nodes only — never raw HTML — so stored or generated text cannot inject markup.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<![\w/])_[^_\s][^_]*_(?!\w)|https?:\/\/[^\s)<>\]]+|\bTODO\b:?|\bPLACEHOLDER\b)/g;
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const key = `${keyBase}-${i++}`;
    const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (token.startsWith("**")) out.push(<strong key={key}>{inline(token.slice(2, -2), key)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (link) {
      const href = link[2] ?? "";
      if (SAFE_HREF.test(href)) {
        const external = /^https?:/i.test(href);
        out.push(<a key={key} href={href} {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}>{link[1]}</a>);
      } else out.push(link[1]);
    } else if (token.startsWith("_")) out.push(<em key={key}>{token.slice(1, -1)}</em>);
    else if (token.startsWith("TODO") || token === "PLACEHOLDER") out.push(<mark key={key} className="todo" title="To be completed by a person">{token.replace(/:$/, "")}</mark>);
    else out.push(<a key={key} href={token} target="_blank" rel="noreferrer noopener">{token.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a>);
    last = index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) => line.replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => c.trim());
const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isListItem = (line: string) => /^\s*([-*+]|\d+[.)])\s+/.test(line);
const BLOCK_START = /^(#{1,6}\s|\s*([-*+]|\d+[.)])\s+|\s*\||\s*>|\s*```|\s*(---+|\*\*\*+)\s*$)/;
const CALLOUT = /^\*{0,2}(Note|Tip|Important|Warning|Caution)\*{0,2}:?\*{0,2}\s*/i;

interface ListNode { ordered: boolean; items: { text: string; children: ListNode[] }[] }

/** Build nested lists from indentation (two or more spaces per level). */
function parseList(lines: string[]): ListNode {
  const indentOf = (line: string) => line.match(/^\s*/)?.[0].replace(/\t/g, "  ").length ?? 0;
  const walk = (start: number, indent: number): { node: ListNode; next: number } => {
    const node: ListNode = { ordered: /^\s*\d+[.)]\s+/.test(lines[start] ?? ""), items: [] };
    let i = start;
    while (i < lines.length) {
      const line = lines[i] ?? "";
      const depth = indentOf(line);
      if (depth < indent) break;
      if (depth > indent + 1 && node.items.length) {
        const child = walk(i, depth);
        node.items[node.items.length - 1]!.children.push(child.node);
        i = child.next;
        continue;
      }
      node.items.push({ text: line.replace(/^\s*([-*+]|\d+[.)])\s+/, ""), children: [] });
      i++;
    }
    return { node, next: i };
  };
  return walk(0, indentOf(lines[0] ?? "")).node;
}

function renderList(list: ListNode, key: string): ReactNode {
  const items = list.items.map((item, n) => {
    const box = item.text.match(/^\[( |x)\]\s+(.*)$/i);
    const k = `${key}-${n}`;
    return (
      <li key={k} className={box ? "task-item" : undefined}>
        {box ? (
          <>
            <span className={box[1] === " " ? "box" : "box checked"} role="img" aria-label={box[1] === " " ? "Not done" : "Done"} />
            <span>{inline(box[2] ?? "", k)}</span>
          </>
        ) : (
          inline(item.text, k)
        )}
        {item.children.map((child, c) => renderList(child, `${k}c${c}`))}
      </li>
    );
  });
  const tasks = list.items.length > 0 && list.items.every((item) => /^\[( |x)\]\s/i.test(item.text));
  return list.ordered ? <ol key={key}>{items}</ol> : <ul key={key} className={tasks ? "task-list" : undefined}>{items}</ul>;
}

/**
 * Markdown renderer for stored knowledge, blueprint sections, generated documents and AI answers:
 * headings, nested and task lists, tables, block quotes and call-outs, rules, fenced code, and Mermaid diagrams.
 */
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
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? "")) body.push(lines[i++] ?? "");
      i++;
      const language = (fence[1] ?? "").toLowerCase();
      const code = body.join("\n");
      blocks.push(language === "mermaid" ? <MermaidDiagram key={k} code={code} /> : <CodeBlock key={k} code={code} language={language} />);
    } else if (heading) {
      const level = heading[1]!.length;
      const content = inline(heading[2] ?? "", k);
      blocks.push(level === 1 ? <h2 key={k} className="h-title">{content}</h2> : level === 2 ? <h3 key={k} className="h-section">{content}</h3> : level === 3 ? <h4 key={k}>{content}</h4> : <h5 key={k}>{content}</h5>);
      i++;
    } else if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      blocks.push(<hr key={k} />);
      i++;
    } else if (isTableRow(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i] ?? "")) rows.push(cells(lines[i++] ?? ""));
      // A two-column table with an empty header is a property list (used by the generated document headers).
      const properties = head.length === 2 && head.every((c) => !c);
      blocks.push(
        properties ? (
          <dl key={k} className="props">
            {rows.map((row, r) => (
              <div key={r}><dt>{inline(row[0] ?? "", `${k}p${r}a`)}</dt><dd>{inline(row[1] ?? "", `${k}p${r}b`)}</dd></div>
            ))}
          </dl>
        ) : (
          <div key={k} className="table-scroll" tabIndex={0} role="region" aria-label="Table">
            <table>
              <thead><tr>{head.map((c, n) => <th key={n} scope="col">{inline(c, `${k}h${n}`)}</th>)}</tr></thead>
              <tbody>{rows.map((row, r) => <tr key={r}>{head.map((_, n) => <td key={n}>{inline(row[n] ?? "", `${k}r${r}c${n}`)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ),
      );
    } else if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) quote.push((lines[i++] ?? "").replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote key={k}><Markdown text={quote.join("\n")} /></blockquote>);
    } else if (isListItem(line)) {
      const items: string[] = [];
      while (i < lines.length && (isListItem(lines[i] ?? "") || (/^\s{2,}\S/.test(lines[i] ?? "") && items.length > 0 && !BLOCK_START.test((lines[i] ?? "").trim())))) {
        const current = lines[i++] ?? "";
        if (isListItem(current)) items.push(current);
        else items[items.length - 1] += ` ${current.trim()}`;
      }
      blocks.push(renderList(parseList(items), k));
    } else {
      const para: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim() && !BLOCK_START.test(lines[i] ?? "")) para.push((lines[i++] ?? "").trim());
      if (para.length === 0) para.push(lines[i++] ?? "");
      const joined = para.join(" ");
      const callout = joined.match(CALLOUT);
      blocks.push(
        callout ? (
          <p key={k} className={`callout ${/warning|caution|important/i.test(callout[1] ?? "") ? "warn" : "info"}`}>
            <strong>{callout[1]}</strong>
            {inline(joined.slice(callout[0].length), k)}
          </p>
        ) : (
          <p key={k}>{inline(joined, k)}</p>
        ),
      );
    }
  }
  return <div className="prose">{blocks}</div>;
}
