import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { keyOf } from "./lib/merge.mjs";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const errors = [];
const err = (m) => errors.push(m);

const files = readdirSync(PUBLIC).filter((f) => /^\d{4}\.json$/.test(f));
if (files.length === 0) err("public/에 연도 JSON이 없습니다.");

for (const f of files) {
  const year = f.slice(0, 4);
  let arr;
  try {
    arr = JSON.parse(readFileSync(join(PUBLIC, f), "utf8"));
  } catch {
    err(`${f}: JSON 파싱 실패`);
    continue;
  }
  if (!Array.isArray(arr)) { err(`${f}: 배열이 아님`); continue; }

  const seen = new Set();
  let prevDate = "";
  let prevKind = 0;
  for (const d of arr) {
    if (typeof d !== "object" || d === null) {
      err(`${f}: 배열 요소가 객체가 아님`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) err(`${f}: 날짜 형식 오류 ${d.date}`);
    else if (!d.date.startsWith(`${year}-`)) err(`${f}: ${d.date}는 연도 밖`);
    if (![1, 2, 3, 4].includes(d.kind)) err(`${f}: kind 범위 오류 ${d.kind} (${d.date})`);
    if (typeof d.name !== "string" || d.name.trim() === "") err(`${f}: name 비어있음 (${d.date})`);
    if (typeof d.holiday !== "boolean") err(`${f}: holiday가 boolean이 아님 (${d.date})`);

    const k = keyOf(d);
    if (seen.has(k)) err(`${f}: 중복 ${k}`);
    seen.add(k);

    if (d.date < prevDate || (d.date === prevDate && d.kind < prevKind)) {
      err(`${f}: 정렬 위반 ${d.date}/${d.kind}`);
    }
    prevDate = d.date;
    prevKind = d.kind;
  }
}

try {
  const idx = JSON.parse(readFileSync(join(PUBLIC, "index.json"), "utf8"));
  const fileYears = files.map((f) => Number(f.slice(0, 4))).sort((a, b) => a - b);
  if (JSON.stringify(idx.years) !== JSON.stringify(fileYears)) {
    err("index.json의 years가 실제 파일 목록과 불일치");
  }
} catch (e) {
  err(`index.json: ${e.message}`);
}

if (errors.length) {
  console.error(`검증 실패 (${errors.length}건):`);
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}
console.log(`검증 통과: 연도 파일 ${files.length}개`);
