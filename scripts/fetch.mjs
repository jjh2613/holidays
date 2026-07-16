import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OPERATIONS, fetchOperation } from "./lib/api.mjs";
import { normalizeResponse } from "./lib/transform.mjs";
import { mergeDateInfos } from "./lib/merge.mjs";
import { rollingMonths, monthsOfYear } from "./lib/range.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");

function targetMonths() {
  if (process.env.FETCH_YEAR) {
    const year = Number(process.env.FETCH_YEAR);
    if (process.env.FETCH_MONTH) return [{ year, month: Number(process.env.FETCH_MONTH) }];
    return monthsOfYear(year);
  }
  return rollingMonths(new Date(), 3);
}

async function main() {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) {
    console.error("DATA_GO_KR_KEY 환경변수가 없습니다.");
    process.exit(1);
  }

  const months = targetMonths();
  console.log(`조회 범위: ${months.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`).join(", ")}`);

  const byYear = new Map();
  for (const { year, month } of months) {
    for (const op of OPERATIONS) {
      const json = await fetchOperation(op, year, month, key);
      const infos = normalizeResponse(json);
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(...infos);
    }
  }

  for (const [year, incoming] of byYear) {
    const file = join(PUBLIC, `${year}.json`);
    const existing = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
    const merged = mergeDateInfos(existing, incoming);
    writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
    console.log(`${year}.json: ${merged.length}건`);
  }

  updateIndex();
}

function updateIndex() {
  const years = readdirSync(PUBLIC)
    .filter((f) => /^\d{4}\.json$/.test(f))
    .map((f) => Number(f.slice(0, 4)))
    .sort((a, b) => a - b);
  writeFileSync(
    join(PUBLIC, "index.json"),
    JSON.stringify({ years, updatedAt: new Date().toISOString() }, null, 2) + "\n",
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
