import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { keyOf } from "./lib/merge.mjs";
import { buildPublic } from "./lib/build.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUTO = join(ROOT, "auto");
const MANUAL = join(ROOT, "manual");
const PUBLIC = join(ROOT, "public");

const errors = [];
const err = (m) => errors.push(m);

function yearsIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f)).map((f) => Number(f.slice(0, 4)));
}

function readLayer(dir, year) {
  const file = join(dir, `${year}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
}

function validateEntries(label, year, arr) {
  if (!Array.isArray(arr)) { err(`${label}: 배열이 아님`); return; }
  for (const d of arr) {
    if (typeof d !== "object" || d === null) { err(`${label}: 배열 요소가 객체가 아님`); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) err(`${label}: 날짜 형식 오류 ${d.date}`);
    else if (!d.date.startsWith(`${year}-`)) err(`${label}: ${d.date}는 연도 밖`);
    if (![1, 2, 3, 4].includes(d.kind)) err(`${label}: kind 범위 오류 ${d.kind} (${d.date})`);
    if (typeof d.name !== "string" || d.name.trim() === "") err(`${label}: name 비어있음 (${d.date})`);
    if (typeof d.holiday !== "boolean") err(`${label}: holiday가 boolean이 아님 (${d.date})`);
    if (d.remarks !== null && typeof d.remarks !== "string") err(`${label}: remarks가 string|null이 아님 (${d.date})`);
    if (d.time !== null && typeof d.time !== "string") err(`${label}: time이 string|null이 아님 (${d.date})`);
    if (d.sunLng !== null && typeof d.sunLng !== "number") err(`${label}: sunLng이 number|null이 아님 (${d.date})`);
  }
}

const autoYears = yearsIn(AUTO);
const manualYears = yearsIn(MANUAL);
const publicYears = yearsIn(PUBLIC);
const allYears = [...new Set([...autoYears, ...manualYears])].sort((a, b) => a - b);

if (autoYears.length === 0) err("auto/에 연도 JSON이 없습니다.");

// 1) 각 레이어 파싱 + 요소 스키마
for (const [dir, name, years] of [[AUTO, "auto", autoYears], [MANUAL, "manual", manualYears], [PUBLIC, "public", publicYears]]) {
  for (const year of years) {
    let arr;
    try { arr = JSON.parse(readFileSync(join(dir, `${year}.json`), "utf8")); }
    catch { err(`${name}/${year}.json: JSON 파싱 실패`); continue; }
    validateEntries(`${name}/${year}.json`, year, arr);
  }
}

// 2) public 정렬 + keyOf 완전 중복
for (const year of publicYears) {
  let arr;
  try { arr = JSON.parse(readFileSync(join(PUBLIC, `${year}.json`), "utf8")); } catch { continue; }
  if (!Array.isArray(arr)) continue;
  const seen = new Set();
  let prevDate = "", prevKind = 0;
  for (const d of arr) {
    if (typeof d !== "object" || d === null) continue;
    const k = keyOf(d);
    if (seen.has(k)) err(`public/${year}.json: 중복 ${k}`);
    seen.add(k);
    if (d.date < prevDate || (d.date === prevDate && d.kind < prevKind)) {
      err(`public/${year}.json: 정렬 위반 ${d.date}/${d.kind}`);
    }
    prevDate = d.date; prevKind = d.kind;
  }
}

// 3) 무결성: public == build(auto, manual)
for (const year of allYears) {
  try {
    const expected = JSON.stringify(buildPublic(readLayer(AUTO, year), readLayer(MANUAL, year)), null, 2) + "\n";
    const file = join(PUBLIC, `${year}.json`);
    const actual = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (actual !== expected) err(`public/${year}.json이 최신이 아님 (npm run build 필요)`);
  } catch (e) {
    err(`${year}: 무결성 검사 중 오류 - ${e.message}`);
    continue;
  }
}

// 4) index.json years 일치
try {
  const idx = JSON.parse(readFileSync(join(PUBLIC, "index.json"), "utf8"));
  if (JSON.stringify(idx.years) !== JSON.stringify(allYears)) {
    err("index.json의 years가 실제 연도 목록과 불일치");
  }
} catch (e) {
  err(`index.json: ${e.message}`);
}

if (errors.length) {
  console.error(`검증 실패 (${errors.length}건):`);
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}
console.log(`검증 통과: auto ${autoYears.length} / manual ${manualYears.length} / public ${publicYears.length} 연도`);
