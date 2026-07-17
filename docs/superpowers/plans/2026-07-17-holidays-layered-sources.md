# 공휴일 JSON — auto/manual 레이어 분리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자동(API)·수동 데이터를 `auto/`·`manual/` 레이어로 분리하고, 둘을 병합한 결과를 `public/`으로 생성해 수동 관리를 안전·추적 가능하게 만든다.

**Architecture:** `auto/{year}.json`(fetch가 씀) + `manual/{year}.json`(사람이 씀)을 `build`가 `date|kind` 그룹 단위로 병합(수동 우선)해 `public/{year}.json`을 생성한다. CDN은 `public/`을 서빙한다. distbe 참조 제거, seed 삭제(데이터는 이미 커밋됨).

**Tech Stack:** Node.js 22, ESM `.mjs`, 런타임 의존성 0(내장 `fetch`/`node:fs`/`node:test`). GitHub Actions + `peter-evans/create-pull-request@v6`, jsDelivr.

## Global Constraints

- Node.js 22 이상. 모든 스크립트는 ESM `.mjs`. **외부 npm 런타임 의존성 0.**
- `DateInfo` 스키마 불변: `{ date:"YYYY-MM-DD", name:string, holiday:boolean, remarks:string|null, kind:1|2|3|4, time:string|null, sunLng:number|null }`.
- 정렬: `date` 오름차순 → 같은 날짜는 `kind` 오름차순. (`sortDateInfos`)
- 키: `keyOf = ${date}|${kind}|${name}`, `groupKey = ${date}|${kind}`.
- **auto 병합**(fetch): `keyOf` 기준 **incoming(API) 우선**.
- **public 병합**(build): `groupKey` 기준 **manual 우선**(그룹 통째 대체). **삭제 미지원.**
- JSON 직렬화 형식(정본): `JSON.stringify(x, null, 2) + "\n"` (2-space 들여쓰기 + 끝 개행).
- 소비자 URL은 `public/{year}.json`로 **불변**.
- API 키는 `.env`/GitHub Secret에만. 대화·커밋·로그에 남기지 않음. **Decoding 키** 저장, 코드가 1회 인코딩.

---

### Task 1: `mergeDateInfos`를 incoming(API)-우선으로 되돌림

이제 수동 보존은 `manual/` 레이어가 담당하므로, auto 레이어에 병합하는 `mergeDateInfos`는 API를 진실의 원천으로 삼아 incoming이 승리해야 한다.

**Files:**
- Modify: `scripts/lib/merge.mjs`
- Test: `scripts/lib/merge.test.mjs`

**Interfaces:**
- Produces: `keyOf(d) -> string`, `sortDateInfos(arr) -> DateInfo[]`, `mergeDateInfos(existing, incoming) -> DateInfo[]` (incoming-wins).

- [ ] **Step 1: 테스트를 incoming-우선으로 수정**

`scripts/lib/merge.test.mjs`를 아래 전체 내용으로 교체:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { keyOf, sortDateInfos, mergeDateInfos } from "./merge.mjs";

const di = (date, kind, name, extra = {}) =>
  ({ date, name, holiday: false, remarks: null, kind, time: null, sunLng: null, ...extra });

test("keyOf: date|kind|name", () => {
  assert.equal(keyOf(di("2026-01-01", 1, "새해")), "2026-01-01|1|새해");
});

test("sortDateInfos: 날짜 asc, 동일 날짜는 kind asc", () => {
  const out = sortDateInfos([
    di("2026-01-05", 3, "소한"),
    di("2026-01-01", 3, "절기X"),
    di("2026-01-01", 1, "새해"),
  ]);
  assert.deepEqual(out.map((d) => [d.date, d.kind]), [
    ["2026-01-01", 1], ["2026-01-01", 3], ["2026-01-05", 3],
  ]);
});

test("mergeDateInfos: collision 시 incoming(API)이 승리", () => {
  const existing = [di("2026-01-01", 1, "새해", { holiday: true, remarks: "old" })];
  const incoming = [di("2026-01-01", 1, "새해", { holiday: true, remarks: "new" })];
  const merged = mergeDateInfos(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].remarks, "new");
});

test("mergeDateInfos: 조회 범위 밖 기존 항목 보존 + 신규 incoming 추가", () => {
  const existing = [
    di("2026-01-01", 1, "새해", { remarks: "old" }),
    di("2026-12-25", 1, "크리스마스"),
  ];
  const incoming = [
    di("2026-01-01", 1, "새해", { remarks: "new" }),
    di("2026-03-01", 1, "삼일절", { holiday: true }),
  ];
  const merged = mergeDateInfos(existing, incoming);
  assert.deepEqual(merged.map((d) => d.date), ["2026-01-01", "2026-03-01", "2026-12-25"]);
  assert.equal(merged[0].remarks, "new");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test scripts/lib/merge.test.mjs`
Expected: FAIL — "collision 시 incoming이 승리"에서 `remarks`가 `"old"`로 나와 실패.

- [ ] **Step 3: `mergeDateInfos` 방향 뒤집기**

`scripts/lib/merge.mjs`의 `mergeDateInfos`를 아래로 교체(주석 포함):

```js
// auto 레이어 병합: API(incoming)가 진실의 원천 → 같은 키(keyOf)는 incoming이 승리.
export function mergeDateInfos(existing, incoming) {
  const map = new Map();
  for (const d of existing) map.set(keyOf(d), d);
  for (const d of incoming) map.set(keyOf(d), d);
  return sortDateInfos([...map.values()]);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test scripts/lib/merge.test.mjs`
Expected: PASS (4/4).

- [ ] **Step 5: 커밋**

```bash
git add scripts/lib/merge.mjs scripts/lib/merge.test.mjs
git commit -m "refactor: mergeDateInfos를 incoming(API)-우선으로 변경 (auto 레이어용)"
```

---

### Task 2: `buildPublic` 병합 로직 (lib)

`auto`와 `manual`을 `groupKey` 단위로 병합(수동 우선)하는 순수 함수.

**Files:**
- Create: `scripts/lib/build.mjs`
- Test: `scripts/lib/build.test.mjs`

**Interfaces:**
- Consumes: `sortDateInfos` from `./merge.mjs`.
- Produces: `groupKey(d) -> string` (`${date}|${kind}`), `buildPublic(auto, manual) -> DateInfo[]`.

- [ ] **Step 1: 실패 테스트 작성**

`scripts/lib/build.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupKey, buildPublic } from "./build.mjs";

const di = (date, kind, name, extra = {}) =>
  ({ date, name, holiday: false, remarks: null, kind, time: null, sunLng: null, ...extra });

test("groupKey: date|kind (name 제외)", () => {
  assert.equal(groupKey(di("2026-01-01", 1, "새해")), "2026-01-01|1");
});

test("buildPublic: manual 없으면 auto 그대로(정렬)", () => {
  const auto = [di("2026-03-01", 1, "삼일절"), di("2026-01-01", 1, "새해")];
  const out = buildPublic(auto, []);
  assert.deepEqual(out.map((d) => d.date), ["2026-01-01", "2026-03-01"]);
});

test("buildPublic: manual이 같은 date+kind 그룹을 통째 대체(이름 변경)", () => {
  const auto = [di("2026-01-01", 1, "새해", { remarks: "auto" })];
  const manual = [di("2026-01-01", 1, "신정", { remarks: "manual" })];
  const out = buildPublic(auto, manual);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "신정");
  assert.equal(out[0].remarks, "manual");
});

test("buildPublic: 다른 kind 그룹은 영향 없음", () => {
  const auto = [di("2026-05-05", 1, "어린이날"), di("2026-05-05", 3, "입하")];
  const manual = [di("2026-05-05", 1, "어린이날(변경)")];
  const out = buildPublic(auto, manual);
  assert.deepEqual(out.map((d) => [d.kind, d.name]), [[1, "어린이날(변경)"], [3, "입하"]]);
});

test("buildPublic: 같은 date+kind 2건 중 manual이 1건만 적으면 그 그룹은 1건이 됨", () => {
  const auto = [di("2006-05-05", 1, "어린이날"), di("2006-05-05", 1, "석가탄신일")];
  const manual = [di("2006-05-05", 1, "어린이날")];
  const out = buildPublic(auto, manual);
  assert.deepEqual(out.map((d) => d.name), ["어린이날"]);
});

test("buildPublic: manual-only 그룹 추가", () => {
  const auto = [di("2026-01-01", 1, "새해")];
  const manual = [di("2026-06-03", 1, "임시공휴일", { holiday: true })];
  const out = buildPublic(auto, manual);
  assert.deepEqual(out.map((d) => d.date), ["2026-01-01", "2026-06-03"]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test scripts/lib/build.test.mjs`
Expected: FAIL — `Cannot find module './build.mjs'`.

- [ ] **Step 3: 구현**

`scripts/lib/build.mjs`:

```js
import { sortDateInfos } from "./merge.mjs";

export function groupKey(d) {
  return `${d.date}|${d.kind}`;
}

// public = auto + manual. groupKey(date|kind) 단위로 manual이 auto를 통째 대체.
// manual에 존재하는 그룹의 auto 항목은 버리고, 남은 auto + 전체 manual을 정렬한다.
export function buildPublic(auto, manual) {
  const claimed = new Set(manual.map(groupKey));
  const kept = auto.filter((d) => !claimed.has(groupKey(d)));
  return sortDateInfos([...kept, ...manual]);
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test scripts/lib/build.test.mjs`
Expected: PASS (6/6).

- [ ] **Step 5: 커밋**

```bash
git add scripts/lib/build.mjs scripts/lib/build.test.mjs
git commit -m "feat: buildPublic 병합 로직 추가 (groupKey 단위 수동 우선)"
```

---

### Task 3: `build.mjs` 오케스트레이션 스크립트

`auto/` + `manual/`을 읽어 `public/{year}.json`과 `public/index.json`을 생성한다. 데이터가 바뀌지 않은 실행에서 `index.json`의 `updatedAt`이 흔들려 매일 빈 PR이 생기지 않도록, **내용 변경이 있을 때만** `updatedAt`을 갱신한다.

**Files:**
- Create: `scripts/build.mjs`

**Interfaces:**
- Consumes: `buildPublic` from `./lib/build.mjs`.
- Produces: `public/{year}.json` (정본 직렬화), `public/index.json` = `{ years:number[], updatedAt:string }`.

- [ ] **Step 1: 구현**

`scripts/build.mjs`:

```js
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
```

- [ ] **Step 2: 픽스처로 스모크 테스트 (수동, 임시 파일)**

임시 픽스처로 동작 확인 후 반드시 정리:

```bash
mkdir -p auto manual
printf '%s\n' '[{"date":"9999-05-05","name":"테스트","holiday":true,"remarks":null,"kind":1,"time":null,"sunLng":null},{"date":"9999-01-01","name":"테스트새해","holiday":true,"remarks":null,"kind":1,"time":null,"sunLng":null}]' > auto/9999.json
node scripts/build.mjs
cat public/9999.json   # 9999-01-01 먼저(정렬), 2건
node -e "const a=require('./public/9999.json'); if(a[0].date!=='9999-01-01'||a.length!==2){process.exit(1)}; console.log('OK')"
```

Expected: `public/9999.json`에 2건, `9999-01-01`이 먼저. `OK` 출력.

- [ ] **Step 3: 픽스처 정리**

```bash
rm -f auto/9999.json public/9999.json
# auto/ manual/ 이 이 스텝에서 처음 생겼고 비어 있으면 삭제 (마이그레이션 Task 4에서 정식 생성)
rmdir auto manual 2>/dev/null || true
git checkout -- public/index.json 2>/dev/null || true
```

Expected: 픽스처 흔적 없음. `git status`에 `scripts/build.mjs`만 신규로 남음.

- [ ] **Step 4: 커밋**

```bash
git add scripts/build.mjs
git commit -m "feat: build.mjs — auto+manual을 public으로 생성 (변경 시에만 updatedAt 갱신)"
```

---

### Task 4: 데이터 마이그레이션 (`public/` → `auto/`, `manual/` 스캐폴드, `public/` 재생성)

distbe 재조회 없이 기존 커밋 데이터를 이동한다. 이 태스크는 데이터/파일 이동이 산출물이다.

**Files:**
- Move: `public/{2004..2026}.json` → `auto/{year}.json`
- Delete: `public/index.json` (build가 재생성)
- Create: `manual/.gitkeep`, `manual/README.md`
- Regenerate: `public/{year}.json`, `public/index.json` (via `node scripts/build.mjs`)

- [ ] **Step 1: public 연도 파일을 auto로 이동**

```bash
mkdir -p auto
for y in $(seq 2004 2026); do
  [ -f "public/$y.json" ] && git mv "public/$y.json" "auto/$y.json"
done
git rm -q public/index.json
ls auto | wc -l   # 23 기대
```

Expected: `auto/`에 23개 파일. `public/`은 비어 있음(또는 없음).

- [ ] **Step 2: manual 디렉터리 스캐폴드**

```bash
mkdir -p manual
: > manual/.gitkeep
```

`manual/README.md` 작성:

```markdown
# manual/

사람이 관리하는 오버라이드 레이어입니다. `public/`은 `auto/`(API 자동 조회) + 이 디렉터리를 병합한 결과입니다.

## 형식

`manual/{year}.json` — `DateInfo[]` 배열 (auto와 동일 스키마).

```json
[
  {
    "date": "2026-06-03",
    "name": "임시공휴일",
    "holiday": true,
    "remarks": null,
    "kind": 1,
    "time": null,
    "sunLng": null
  }
]
```

## 병합 규칙 (`npm run build`)

- 병합 단위: `date + kind` 그룹.
- 이 파일에 어떤 `date+kind` 그룹이 있으면 → `auto`의 그 그룹은 버리고 이 파일 항목으로 **통째 대체**됩니다.
- 없으면 → `auto` 그대로 사용됩니다.
- **주의**: 같은 날 같은 kind가 여러 건인 경우(예: 어린이날+석가탄신일, 둘 다 kind 1),
  그 그룹을 손대려면 유지할 항목을 **모두** 적어야 합니다. 하나만 적으면 나머지는 사라집니다.
- 편집 후 `npm run build`로 `public/`을 재생성하세요. `npm run validate`가 최신 여부를 검사합니다.
```

- [ ] **Step 3: public 재생성 후 원본과 동일한지 확인**

```bash
node scripts/build.mjs
# 이동 전 커밋(HEAD)의 public/2026.json 과 재생성본이 동일해야 함 (manual 없음)
for y in 2004 2015 2026; do
  git show "HEAD:public/$y.json" | diff - "public/$y.json" && echo "$y OK"
done
```

Expected: 각 연도 `diff` 출력 없음 + `YYYY OK`. (내용 동일)

- [ ] **Step 4: 검증·테스트 (Task 5 완료 후 재실행)**

> 참고: `validate.mjs`는 Task 5에서 3-레이어용으로 바뀐다. 이 태스크 시점에는 아래를 확인:

```bash
npm test
```

Expected: 기존 + 신규 테스트 모두 PASS.

- [ ] **Step 5: 커밋**

```bash
git add auto manual public
git commit -m "chore: 데이터 레이어 분리 마이그레이션 (public→auto, manual 스캐폴드, public 재생성)"
```

---

### Task 5: `validate.mjs` 3-레이어 검증 + 무결성 검사

auto/manual/public 각 레이어를 검증하고, `public`이 `build(auto, manual)` 결과와 바이트 동일한지(최신 여부) 확인한다.

**Files:**
- Modify (전체 교체): `scripts/validate.mjs`

**Interfaces:**
- Consumes: `keyOf` from `./lib/merge.mjs`, `buildPublic` from `./lib/build.mjs`.

- [ ] **Step 1: 전체 교체**

`scripts/validate.mjs`:

```js
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
  const expected = JSON.stringify(buildPublic(readLayer(AUTO, year), readLayer(MANUAL, year)), null, 2) + "\n";
  const file = join(PUBLIC, `${year}.json`);
  const actual = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (actual !== expected) err(`public/${year}.json이 최신이 아님 (npm run build 필요)`);
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
```

- [ ] **Step 2: 마이그레이션된 데이터로 통과 확인**

Run: `node scripts/validate.mjs`
Expected: `검증 통과: auto 23 / manual 0 / public 23 연도`.

- [ ] **Step 3: 무결성 검사가 실제로 잡는지 확인 (public 손상 → 실패 → 복구)**

```bash
node -e "const f='public/2026.json';const fs=require('fs');const a=JSON.parse(fs.readFileSync(f));a.push({date:'2026-12-31',name:'가짜',holiday:false,remarks:null,kind:1,time:null,sunLng:null});fs.writeFileSync(f,JSON.stringify(a,null,2)+'\n')"
node scripts/validate.mjs; echo "exit=$?"   # 최신 아님 → 실패, exit=1 기대
node scripts/build.mjs                        # 복구
node scripts/validate.mjs; echo "exit=$?"   # 통과, exit=0 기대
```

Expected: 첫 실행 실패(exit=1, "최신이 아님"), build 후 통과(exit=0).

- [ ] **Step 4: 커밋**

```bash
git add scripts/validate.mjs
git commit -m "feat: validate를 3-레이어 검증 + public 최신 무결성 검사로 확장"
```

---

### Task 6: `fetch.mjs`가 `auto/`에만 쓰도록 변경

fetch는 API 조회 결과를 `auto/{year}.json`에만 병합한다. `index.json`은 더 이상 fetch가 쓰지 않는다(build 담당).

**Files:**
- Modify (전체 교체): `scripts/fetch.mjs`

**Interfaces:**
- Consumes: `OPERATIONS`, `fetchOperation` (`./lib/api.mjs`), `normalizeResponse` (`./lib/transform.mjs`), `mergeDateInfos` (`./lib/merge.mjs`, incoming-wins), `rollingMonths`, `monthsOfYear` (`./lib/range.mjs`).

- [ ] **Step 1: 전체 교체**

`scripts/fetch.mjs`:

```js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OPERATIONS, fetchOperation } from "./lib/api.mjs";
import { normalizeResponse } from "./lib/transform.mjs";
import { mergeDateInfos } from "./lib/merge.mjs";
import { rollingMonths, monthsOfYear } from "./lib/range.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUTO = join(ROOT, "auto");

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

  mkdirSync(AUTO, { recursive: true });
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
    const file = join(AUTO, `${year}.json`);
    const existing = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
    const merged = mergeDateInfos(existing, incoming);
    writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
    console.log(`auto/${year}.json: ${merged.length}건`);
  }

  console.log("fetch 완료. `npm run build`로 public을 재생성하세요.");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 오프라인 가드 확인 (키 없으면 exit 1)**

Run: `DATA_GO_KR_KEY= node scripts/fetch.mjs; echo "exit=$?"`
Expected: `DATA_GO_KR_KEY 환경변수가 없습니다.` + `exit=1`. (네트워크 조회는 실제 키가 필요하므로 미검증 — 첫 워크플로우 실행 때 확인)

- [ ] **Step 3: 커밋**

```bash
git add scripts/fetch.mjs
git commit -m "refactor: fetch가 auto/에만 병합, index는 build가 담당"
```

---

### Task 7: `seed.mjs` 삭제 + `package.json` 스크립트 갱신

**Files:**
- Delete: `scripts/seed.mjs`
- Modify: `package.json`

- [ ] **Step 1: seed 삭제**

```bash
git rm scripts/seed.mjs
```

- [ ] **Step 2: package.json scripts 갱신**

`package.json`의 `scripts`를 아래로 교체 (seed 제거, build 추가):

```json
  "scripts": {
    "test": "node --test",
    "build": "node scripts/build.mjs",
    "fetch": "node scripts/fetch.mjs",
    "validate": "node scripts/validate.mjs"
  },
```

- [ ] **Step 3: 확인**

```bash
grep -q '"seed"' package.json && echo "FAIL: seed 잔존" || echo "OK: seed 제거됨"
npm run build && npm run validate
```

Expected: `OK: seed 제거됨`, build·validate 통과.

- [ ] **Step 4: 커밋**

```bash
git add package.json
git commit -m "chore: seed.mjs 삭제(distbe 불필요), npm run build 추가"
```

---

### Task 8: 워크플로우에 build 단계 추가

`fetch → build → validate → PR` 순서로 만든다. 브랜치명은 데이터 디렉터리 `auto/`와의 혼동을 피해 `bot/*`로 변경.

**Files:**
- Modify: `.github/workflows/update.yml`
- Modify: `.github/workflows/backfill.yml`

- [ ] **Step 1: update.yml 갱신**

`.github/workflows/update.yml`을 아래 전체로 교체:

```yaml
name: 공휴일 자동 갱신
on:
  schedule:
    - cron: "0 0 * * *" # UTC 0시 = KST 09시
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: 특일정보 조회 (3개월 롤링)
        run: node scripts/fetch.mjs
        env:
          DATA_GO_KR_KEY: ${{ secrets.DATA_GO_KR_KEY }}
      - name: public 생성
        run: node scripts/build.mjs
      - name: 검증
        run: node scripts/validate.mjs
      - name: PR 생성
        uses: peter-evans/create-pull-request@v6
        with:
          branch: bot/holidays-update
          title: "chore: 공휴일 데이터 자동 갱신"
          commit-message: "chore: 공휴일 데이터 자동 갱신"
          body: |
            공공데이터포털 특일정보 API 자동 조회 결과입니다(이번 달~다다음 달).
            `auto/`(원본)와 병합 결과인 `public/` 변경을 확인 후 머지하세요.
          delete-branch: true
```

- [ ] **Step 2: backfill.yml 갱신**

`.github/workflows/backfill.yml`을 아래 전체로 교체:

```yaml
name: 공휴일 수동 백필
on:
  workflow_dispatch:
    inputs:
      year:
        description: "조회할 연도 (예: 2025)"
        required: true
      month:
        description: "조회할 월 (1-12, 비우면 12개월 전체)"
        required: false
permissions:
  contents: write
  pull-requests: write
jobs:
  backfill:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: 특일정보 조회 (연/월 지정)
        run: node scripts/fetch.mjs
        env:
          DATA_GO_KR_KEY: ${{ secrets.DATA_GO_KR_KEY }}
          FETCH_YEAR: ${{ inputs.year }}
          FETCH_MONTH: ${{ inputs.month }}
      - name: public 생성
        run: node scripts/build.mjs
      - name: 검증
        run: node scripts/validate.mjs
      - name: PR 생성
        uses: peter-evans/create-pull-request@v6
        with:
          branch: bot/holidays-backfill-${{ inputs.year }}
          title: "chore: 공휴일 백필 ${{ inputs.year }}${{ inputs.month && format('-{0}', inputs.month) || '' }}"
          commit-message: "chore: 공휴일 백필 ${{ inputs.year }}${{ inputs.month && format('-{0}', inputs.month) || '' }}"
          body: |
            수동 백필 결과입니다 (연도: ${{ inputs.year }}, 월: ${{ inputs.month || '전체' }}).
            `auto/`와 병합 결과인 `public/` 변경을 확인 후 머지하세요.
          delete-branch: true
```

- [ ] **Step 3: YAML 문법 확인**

```bash
node -e "const fs=require('fs');for(const f of ['.github/workflows/update.yml','.github/workflows/backfill.yml']){const s=fs.readFileSync(f,'utf8');if(!s.includes('node scripts/build.mjs'))throw new Error('build 단계 누락: '+f)};console.log('OK')"
```

Expected: `OK`.

- [ ] **Step 4: 커밋**

```bash
git add .github/workflows/update.yml .github/workflows/backfill.yml
git commit -m "ci: 워크플로우에 build 단계 추가, 브랜치명 bot/*로 변경"
```

---

### Task 9: 문서 갱신 (README, types.ts)

distbe 참조 제거, 3-레이어 구조와 수동 편집법을 문서화한다.

**Files:**
- Modify: `README.md`
- Modify: `types.ts`

- [ ] **Step 1: README 전체 교체**

`README.md`를 아래 전체로 교체:

````markdown
# holidays

[![jsDelivr](https://img.shields.io/badge/CDN-jsDelivr-orange)](https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/index.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

한국의 **공휴일·기념일·24절기·잡절** 데이터를 연도별 JSON으로 관리하고 CDN으로 배포하는 프로젝트입니다.
서버·빌드 없이 [jsDelivr](https://www.jsdelivr.com/) CDN에서 바로 가져다 쓸 수 있습니다.

- 📅 2004~2026년 데이터 수록 (`public/{year}.json`)
- 🔄 공공데이터포털 특일정보 API로 자동 갱신 (매일, PR로 검토 후 반영)
- ✍️ 자동(`auto/`)·수동(`manual/`) 레이어 분리 — 수동 편집이 자동 조회에 덮이지 않음
- 📦 런타임 의존성 0 — Node.js 22 내장 기능만 사용

## 빠른 시작

CDN URL에서 연도별 JSON을 가져옵니다. 인증·API 키 불필요.

```
https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/{year}.json
https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/index.json
```

```js
const res = await fetch("https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/2026.json");
const dates = await res.json();

// 2026년 법정공휴일만
const holidays = dates.filter((d) => d.holiday);
```

> **캐시 주의**: `@main`은 jsDelivr 캐시가 최대 12~24시간 유지됩니다.
> 즉시 반영이 필요하면 git 태그를 만들고 `@v1.0.0`처럼 버전을 지정하세요.

## 데이터 레이어

```
auto/{year}.json     API 자동 조회 결과. 손으로 편집하지 않습니다.
manual/{year}.json   사람이 관리하는 오버라이드(추가·수정). 없으면 비어 있음 취급.
public/{year}.json   auto + manual 병합 결과. CDN이 서빙합니다. (build가 생성)
```

셋 다 저장소에 커밋되어 GitHub/CDN에서 각각 확인할 수 있습니다. 소비자는 **`public/`만** 쓰면 됩니다.

## 데이터 스키마

세 레이어 모두 동일한 `DateInfo[]`이며, `public`은 `date` → `kind` 순 정렬입니다.

```ts
interface DateInfo {
  date: string;        // "YYYY-MM-DD"
  name: string;        // 예: "새해"
  holiday: boolean;    // 법정공휴일 여부
  remarks: string | null;
  kind: 1 | 2 | 3 | 4; // 아래 표 참고
  time: string | null; // 절기만 "HH:mm"
  sunLng: number | null;
}
```

| `kind` | 의미 | 예 |
| :----: | ---- | --- |
| 1 | 공휴일 | 새해, 삼일절, 추석 |
| 2 | 기념일 | 식목일, 스승의 날 |
| 3 | 24절기 | 입춘, 하지 (`time`·`sunLng` 포함) |
| 4 | 잡절 | 단오, 초복 |

`index.json`: `{ "years": number[], "updatedAt": string }`

## 병합 규칙 (`public = build(auto, manual)`)

`date + kind` 그룹 단위로 병합하며 **manual이 우선**합니다.

- `manual`에 해당 `date+kind` 그룹이 있으면 → `auto`의 그 그룹을 버리고 **manual로 통째 대체**.
- 없으면 → `auto` 그대로.
- **수동 편집이 항상 우선**이므로 자동 조회가 수동 값을 덮지 않습니다.
- 삭제(auto 단독 항목 완전 제거)는 현재 지원하지 않습니다.

수동 편집법은 [`manual/README.md`](./manual/README.md) 참고. 편집 후 `npm run build`로 `public/`을 재생성하세요.

## 로컬 개발

Node.js 22 이상이 필요합니다. 외부 npm 의존성은 없습니다.

```bash
# 1) API 키 준비 — 공공데이터포털 Decoding 키(날것)를 넣습니다. Encoding 키는 넣지 마세요.
cp .env.example .env && $EDITOR .env   # DATA_GO_KR_KEY=...

# 2) 특일정보 조회 → auto/ 갱신 (기본: 이번 달~다다음 달, 3개월 롤링)
node --env-file=.env scripts/fetch.mjs
# 특정 연/월만: FETCH_YEAR=2027 FETCH_MONTH=1 node --env-file=.env scripts/fetch.mjs

# 3) public/ 생성 (auto + manual 병합)
npm run build

# 4) 검증 / 테스트
npm run validate
npm test
```

> **API 키 주의**: 공공데이터포털은 Encoding 키와 Decoding 키를 함께 발급합니다.
> 이 프로젝트는 **Decoding 키(날것)** 를 저장하고 코드가 1회만 URL 인코딩합니다.
> Encoding 키를 넣으면 이중 인코딩으로 `401`이 발생합니다.

## 자동화 (GitHub Actions)

- **공휴일 자동 갱신** (`.github/workflows/update.yml`): 매일 KST 09시 → 조회 → build → 변경 시 PR 생성.
- **공휴일 수동 백필** (`.github/workflows/backfill.yml`): Actions 탭에서 연/월을 지정해 수동 실행 → PR 생성.

두 워크플로우 모두 `main`에 직접 커밋하지 않고 **PR로만** 올립니다. `auto/`와 그 결과인 `public/` diff를 확인한 뒤 머지하세요.

### 설정

1. **Secret 등록** — 저장소 **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `DATA_GO_KR_KEY`
   - Value: 공공데이터포털 **Decoding 키**
2. **PR 생성 권한 허용** — **Settings → Actions → General → Workflow permissions**
   - "Allow GitHub Actions to create and approve pull requests" 체크

## 데이터 출처

공공데이터포털 [한국천문연구원_특일 정보](https://www.data.go.kr/data/15012690/openapi.do).

## 기여

이슈와 PR을 환영합니다. 데이터 오류 제보 시 해당 `날짜 / 이름 / 연도 파일`을 함께 적어 주세요.
PR 전에 `npm run build` 후 `npm run validate`와 `npm test`가 통과하는지 확인해 주세요.

## 라이선스

[MIT](./LICENSE) — 코드 및 이 저장소의 구성물.
원본 특일 데이터의 이용 조건은 공공데이터포털의 이용허락범위를 따릅니다.
````

- [ ] **Step 2: types.ts 주석 보강**

`types.ts` 최상단에 아래 주석을 추가(기존 `interface DateInfo`는 유지):

```ts
// auto/{year}.json, manual/{year}.json, public/{year}.json 모두 이 DateInfo[] 형식입니다.
// 소비자는 public/{year}.json을 사용하세요.
```

- [ ] **Step 3: 링크·문구 확인**

```bash
grep -qi distbe README.md && echo "FAIL: distbe 잔존" || echo "OK: distbe 제거됨"
grep -q "npm run build" README.md && echo "OK: build 문서화" || echo "FAIL"
```

Expected: `OK: distbe 제거됨`, `OK: build 문서화`.

- [ ] **Step 4: 커밋**

```bash
git add README.md types.ts
git commit -m "docs: 3-레이어 구조·수동 편집법 문서화, distbe 참조 제거"
```

---

## 최종 확인 (전체)

모든 태스크 후:

```bash
npm test            # 전체 통과
npm run build       # public 재생성 (변경 없으면 index 그대로)
npm run validate    # 검증 통과: auto 23 / manual 0 / public 23 연도
git status          # 깔끔
```
