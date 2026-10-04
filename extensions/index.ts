import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AUTO_LABEL_LIMIT = 80;
// ponytail: top-level "/file " is reserved; add escaping only if real collisions appear.
const FILE_SEPARATOR = "/file ";

type PreparedFile = {
  name: string;
  path: string;
  text: string;
  bytes: number;
  label?: string;
};

function splitFiles(text: string): string[] {
  const files: string[] = [];
  let start = 0;
  let fence: { marker: "`" | "~"; length: number } | undefined;

  for (const match of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    const chunk = match[0];
    if (!chunk) break;

    const lineStart = match.index!;
    let line = chunk.replace(/\r\n$|\r$|\n$/, "");

    if (!fence && line.startsWith(FILE_SEPARATOR)) {
      let end = lineStart;
      if (end >= 2 && text.slice(end - 2, end) === "\r\n") end -= 2;
      else if (end > 0 && (text[end - 1] === "\n" || text[end - 1] === "\r")) {
        end--;
      }

      files.push(text.slice(start, end));
      start = lineStart + FILE_SEPARATOR.length;
      line = line.slice(FILE_SEPARATOR.length);
    }

    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (
        closing &&
        closing[1][0] === fence.marker &&
        closing[1].length >= fence.length
      ) {
        fence = undefined;
      }
      continue;
    }

    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (opening && (opening[1][0] === "~" || !opening[2].includes("`"))) {
      fence = { marker: opening[1][0] as "`" | "~", length: opening[1].length };
    }
  }

  files.push(text.slice(start));
  return files;
}

function labelFor(text: string): string | undefined {
  const lines = text.split(/\r\n?|\n/);
  let fallback: string | undefined;
  let fence: { marker: "`" | "~"; length: number } | undefined;
  let label: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!fallback && trimmed && !/^(`{3,}|~{3,})/.test(trimmed)) {
      fallback = trimmed;
    }

    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if (
        closing &&
        closing[1][0] === fence.marker &&
        closing[1].length >= fence.length
      ) {
        fence = undefined;
      }
      continue;
    }

    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (opening && (opening[1][0] === "~" || !opening[2].includes("`"))) {
      fence = { marker: opening[1][0] as "`" | "~", length: opening[1].length };
      continue;
    }

    const heading = line.match(/^ {0,3}#{1,6}(?:[ \t]+|$)(.*)$/);
    if (!heading) continue;

    const candidate = heading[1].replace(/[ \t]+#+[ \t]*$/, "").trim();
    if (candidate) {
      label = candidate;
      break;
    }
  }

  label ??= fallback;
  if (!label) return;

  const chars = [...label];
  return chars.length > AUTO_LABEL_LIMIT
    ? `${chars.slice(0, AUTO_LABEL_LIMIT - 1).join("").trimEnd()}…`
    : label;
}

function filenameFor(
  label: string | undefined,
  number: number,
  files: PreparedFile[],
): string {
  const stem = label
    ? [
      ...label
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, ""),
    ]
      .slice(0, 48)
      .join("")
      .replace(/-+$/, "")
    : "";
  const base = stem && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)
    ? stem
    : `text-${number}`;

  for (let suffix = 1;; suffix++) {
    const name = `${base}${suffix === 1 ? "" : `-${suffix}`}.md`;
    if (!files.some((file) => file.name === name)) return name;
  }
}

function xmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\t", "&#9;");
}

function formatFile(file: PreparedFile): string {
  const label = file.label ? ` label="${xmlAttr(file.label)}"` : "";
  return `<file name="${
    xmlAttr(file.path)
  }" bytes="${file.bytes}"${label}>\n${file.text}\n</file>`;
}

export default function piFile(pi: ExtensionAPI): void {
  pi.registerCommand("file", {
    description:
      "Create temporary Markdown files and embed them in the input editor",
    handler: async (args, ctx) => {
      const segments = splitFiles(args ?? "");
      for (let index = 0; index < segments.length; index++) {
        if (!segments[index].trim()) {
          ctx.ui.notify(
            index === 0 && segments.length === 1
              ? "Nothing to file."
              : `File ${index + 1} is empty.`,
            "warning",
          );
          return;
        }
      }

      const files: PreparedFile[] = [];
      for (const [index, text] of segments.entries()) {
        const label = labelFor(text);
        const name = filenameFor(label, index + 1, files);
        files.push({
          name,
          path: "",
          text,
          bytes: Buffer.byteLength(text, "utf8"),
          label,
        });
      }

      const dir = await mkdtemp(join(tmpdir(), "pi-file-"));
      for (const file of files) {
        file.path = join(dir, file.name);
        await writeFile(file.path, file.text, "utf8");
      }

      const prompt = files.map(formatFile).join("\n\n");
      ctx.ui.pasteToEditor(prompt);
      if (ctx.mode === "tui") ctx.ui.pasteToEditor("\n");
    },
  });
}
