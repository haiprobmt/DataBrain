import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";

function runs(text: string): TextRun[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part) => {
    if (part.startsWith("**")) return new TextRun({ text: part.slice(2, -2), bold: true });
    if (part.startsWith("`")) return new TextRun({ text: part.slice(1, -1), font: "Consolas" });
    return new TextRun(part.replace(/(^|\s)_([^_]+)_(?=\s|$|[.,;])/g, "$1$2"));
  });
}

const cells = (line: string) => line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** Convert the generated Markdown documents (headings, lists, tables, paragraphs) to a Word file. */
export async function markdownToDocx(markdown: string): Promise<Buffer> {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const children: (Paragraph | Table)[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;
    if (/^\s*```/.test(line)) {
      // Fenced blocks (code, Mermaid source) are kept verbatim in a monospace font; Word cannot draw the diagram.
      const mermaid = /mermaid/i.test(line);
      if (mermaid) children.push(new Paragraph({ children: [new TextRun({ text: "Diagram source (Mermaid). The rendered diagram is in the DataBrain app and in diagrams/architecture.mmd.", italics: true })] }));
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? "")) children.push(new Paragraph({ children: [new TextRun({ text: lines[i++] ?? "", font: "Consolas", size: 18 })] }));
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][heading[1]!.length - 1];
      children.push(new Paragraph({ heading: level, children: runs(heading[2] ?? "") }));
    } else if (/^\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i] ?? "")) {
        if (!/^\|[\s:|-]+\|\s*$/.test(lines[i] ?? "")) rows.push(cells(lines[i] ?? ""));
        i++;
      }
      i--;
      const width = Math.max(...rows.map((r) => r.length));
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map((row, r) => new TableRow({ children: Array.from({ length: width }, (_, c) => new TableCell({ children: [new Paragraph({ children: r === 0 ? [new TextRun({ text: row[c] ?? "", bold: true })] : runs(row[c] ?? "") })] })) })),
        }),
      );
    } else if (/^\s*[-*]\s+/.test(line)) {
      children.push(new Paragraph({ bullet: { level: 0 }, children: runs(line.replace(/^\s*[-*]\s+/, "").replace(/^\[ \]\s*/, "☐ ").replace(/^\[x\]\s*/i, "☑ ")) }));
    } else if (/^\s*\d+\.\s+/.test(line)) {
      children.push(new Paragraph({ children: runs(line.trim()) }));
    } else {
      children.push(new Paragraph({ children: runs(line) }));
    }
  }
  return Packer.toBuffer(new Document({ creator: "DataBrain by DataLabsIQ", sections: [{ children }] }));
}
