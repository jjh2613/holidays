import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPublic } from "./lib/build.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUTO = join(ROOT, "auto");
const MANUAL = join(ROOT, "manual");
const PUBLIC = join(ROOT, "public");

function yearsIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}\.json$/.test(f))
    .map((f) => Number(f.slice(0, 4)));
}

function readLayer(dir, year) {
  const file = join(dir, `${year}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
}

function main() {
  mkdirSync(PUBLIC, { recursive: true });
  const years = [...new Set([...yearsIn(AUTO), ...yearsIn(MANUAL)])].sort((a, b) => a - b);

  let changed = false;
  for (const year of years) {
    const merged = buildPublic(readLayer(AUTO, year), readLayer(MANUAL, year));
    const content = JSON.stringify(merged, null, 2) + "\n";
    const file = join(PUBLIC, `${year}.json`);
    const prev = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (prev !== content) {
      writeFileSync(file, content);
      changed = true;
    }
    console.log(`public/${year}.json: ${merged.length}건`);
  }

  // 데이터 변경이 없고 years도 동일하면 기존 updatedAt 유지 (빈 PR 방지).
  const idxFile = join(PUBLIC, "index.json");
  let updatedAt = new Date().toISOString();
  if (!changed && existsSync(idxFile)) {
    try {
      const old = JSON.parse(readFileSync(idxFile, "utf8"));
      if (old.updatedAt && JSON.stringify(old.years) === JSON.stringify(years)) {
        updatedAt = old.updatedAt;
      }
    } catch { /* 손상된 index.json이면 새 값으로 재작성 */ }
  }
  writeFileSync(idxFile, JSON.stringify({ years, updatedAt }, null, 2) + "\n");
  console.log(`index.json 작성: ${years.length}개 연도`);
}

main();
