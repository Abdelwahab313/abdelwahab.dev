import {readFileSync, existsSync} from "node:fs";
import {resolve} from "node:path";

const DIAGRAM_DIR = resolve("src/diagrams");
const PREFIX = "diagram:";

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function loadSvg(name, alt) {
  const file = resolve(DIAGRAM_DIR, `${name}.svg`);
  if (!file.startsWith(DIAGRAM_DIR) || !existsSync(file)) {
    throw new Error(`remark-diagrams: no file src/diagrams/${name}.svg`);
  }
  const svg = readFileSync(file, "utf8")
    .replace(/<\?xml[^>]*\?>\s*/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  const open = svg.indexOf(">");
  const tag = svg.slice(0, open);
  const labelled = /\srole=/.test(tag)
    ? svg
    : `${tag} role="img" aria-label="${escapeHtml(alt)}"${svg.slice(open)}`;
  return labelled;
}

// `![caption](diagram:name)` on its own line becomes an inline SVG figure
// from src/diagrams/name.svg, so it can use the page's CSS variables.
export default function remarkDiagrams() {
  return tree => {
    const walk = node => {
      if (!node.children) return;
      node.children = node.children.map(child => {
        if (
          child.type === "paragraph" &&
          child.children.length === 1 &&
          child.children[0].type === "image" &&
          child.children[0].url.startsWith(PREFIX)
        ) {
          const image = child.children[0];
          const name = image.url.slice(PREFIX.length);
          const alt = image.alt ?? "";
          const svg = loadSvg(name, alt);
          const caption = alt
            ? `<figcaption>${escapeHtml(alt)}</figcaption>`
            : "";
          return {
            type: "html",
            value: `<figure class="diagram" data-diagram="${escapeHtml(name)}">${svg}${caption}</figure>`
          };
        }
        walk(child);
        return child;
      });
    };
    walk(tree);
  };
}
