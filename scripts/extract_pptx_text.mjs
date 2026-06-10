import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { basename } from "node:path";

const input = process.argv[2];
const output = process.argv[3] || "data/ppt-reference.json";

if (!input) {
  console.error("Usage: node scripts/extract_pptx_text.mjs <pptx> [output]");
  process.exit(1);
}

const listing = execFileSync("unzip", ["-Z1", input], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]));

const slides = [];

for (const entry of listing) {
  const xml = execFileSync("unzip", ["-p", input, entry], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const texts = [...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)]
    .map((match) => decodeXml(match[1]).trim())
    .filter(Boolean);
  slides.push({
    slide: Number(entry.match(/slide(\d+)/)?.[1]),
    text: texts.join("\n"),
    lines: texts
  });
}

const payload = {
  source: input,
  fileName: basename(input),
  extractedAt: new Date().toISOString(),
  slideCount: slides.length,
  slides
};

await writeFile(output, JSON.stringify(payload, null, 2));
console.log(`Extracted ${slides.length} slides to ${output}`);

function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}
