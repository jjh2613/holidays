import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sortDateInfos } from "./lib/merge.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const START = 2004;
const END = 2026;

async function main() {
  mkdirSync(PUBLIC, { recursive: true });
  const years = [];
  for (let year = START; year <= END; year++) {
    const url = `https://cdn.jsdelivr.net/gh/distbe/holidays@gh-pages/${year}.json`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`건너뜀 ${year}: HTTP ${res.status}`);
      continue;
    }
    const data = await res.json();
    const sorted = sortDateInfos(data);
    writeFileSync(join(PUBLIC, `${year}.json`), JSON.stringify(sorted, null, 2) + "\n");
    years.push(year);
    console.log(`시드 완료 ${year}.json (${sorted.length}건)`);
  }
  writeFileSync(
    join(PUBLIC, "index.json"),
    JSON.stringify({ years, updatedAt: new Date().toISOString() }, null, 2) + "\n",
  );
  console.log(`index.json 작성: ${years.length}개 연도`);
}

main().catch((e) => { console.error(e); process.exit(1); });
