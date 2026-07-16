# 공휴일 JSON 배포 시스템 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한국 특일(공휴일·기념일·절기·잡절) 데이터를 연도별 JSON으로 관리하고 jsDelivr로 public URL 배포하며, 공공데이터포털 API를 하이브리드(자동 조회 + PR 수동 머지)로 갱신한다.

**Architecture:** 순수 변환/병합/범위 로직을 `scripts/lib/*.mjs`로 분리(단위 테스트), 네트워크 계층(`api.mjs`)과 오케스트레이션(`seed.mjs`/`fetch.mjs`/`validate.mjs`)을 얇게 유지. 데이터는 `public/{year}.json`에 저장, GitHub Actions 2종(정기 `update.yml`, 수동 `backfill.yml`)이 `fetch.mjs`를 공유 실행하고 `peter-evans/create-pull-request`로 PR을 만든다.

**Tech Stack:** Node.js 22 (ESM `.mjs`, 내장 `fetch`, `node --test`, `--env-file`). **런타임 의존성 0개.** GitHub Actions.

## Global Constraints

- Node.js 22 사용. 외부 npm 의존성 추가 금지(내장 API만).
- 모든 스크립트는 ESM `.mjs`.
- 데이터 스키마 `DateInfo`: `{ date: "YYYY-MM-DD", name: string, holiday: boolean, remarks: string|null, kind: 1|2|3|4, time: string|null, sunLng: number|null }`. `kind` 1=공휴일 2=기념일 3=절기 4=잡절.
- 각 `public/{year}.json`은 `DateInfo[]`이며 **`date` 오름차순 → 동일 날짜는 `kind` 오름차순** 정렬.
- 병합 키: `` `${date}|${kind}|${name}` ``. 병합 시 incoming(API)이 collision에서 이기고, local-only 항목은 보존.
- 인증키는 **Decoding 키(날것)** 를 `DATA_GO_KR_KEY`에 저장. URL 인코딩은 코드(`URLSearchParams`)가 1회 수행. Encoding 키 금지(이중 인코딩 → 401).
- API base: `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService`.
- 사용 오퍼레이션 5종: `getHoliDeInfo`, `getRestDeInfo`, `getAnniversaryInfo`, `get24DivisionsInfo`, `getSundryDayInfo`.
- API 필드 매핑: `locdate`→date, `dateName`→name(정규화), `isHoliday`("Y")→holiday, `remarks`→remarks, `dateKind`("01".."04")→kind, `kst`(HHMM)→time, `sunLongitude`→sunLng.
- 이름 정규화 규칙: `"1월1일"→"새해"`, `"기독탄신일"→"크리스마스"`, `"대체공휴일"`(배열 index>0)→`` `${이전항목 dateName} (대체공휴일)` ``.
- JSON 파일은 2-space 들여쓰기 + 끝에 개행 1개.
- 배포 URL: `https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/{year}.json`.
- 자동 갱신 범위: 이번 달 + 다음 달 + 다다음 달(3개월 롤링). 백필: `FETCH_YEAR`(필수) + `FETCH_MONTH`(선택, 없으면 12개월).

---

## File Structure

```
holidays/
├── package.json                     # {type:"module"}, scripts, deps 없음
├── .gitignore                       # .env, node_modules
├── .env.example                     # DATA_GO_KR_KEY=
├── types.ts                         # 소비자용 DateInfo/DateKind 타입
├── README.md
├── public/
│   ├── 2004.json ~ 2026.json        # seed로 생성
│   └── index.json                   # { years, updatedAt }
├── scripts/
│   ├── lib/
│   │   ├── transform.mjs            # 순수: 필드 변환/정규화
│   │   ├── transform.test.mjs
│   │   ├── merge.mjs                # 순수: keyOf/sortDateInfos/mergeDateInfos
│   │   ├── merge.test.mjs
│   │   ├── range.mjs                # 순수: rollingMonths/monthsOfYear
│   │   ├── range.test.mjs
│   │   ├── api.mjs                  # 네트워크: fetchOperation(+페이지네이션)
│   │   └── api.test.mjs             # fetch mock 주입 테스트
│   ├── seed.mjs                     # 원본 gh-pages → public/*.json
│   ├── fetch.mjs                    # 범위 조회 → 변환 → 병합 → 쓰기 + index
│   └── validate.mjs                 # 전체 public/*.json 검증
└── .github/workflows/
    ├── update.yml                   # cron 3개월 롤링
    └── backfill.yml                 # 수동 연/월 지정
```

---

## Task 1: 프로젝트 스캐폴딩 + 타입

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`, `types.ts`, `public/.gitkeep`

**Interfaces:**
- Consumes: 없음
- Produces: `npm test`(=`node --test`), `npm run seed|fetch|validate` 스크립트 정의. `type: module`.

- [ ] **Step 1: `package.json` 작성**

```json
{
  "name": "holidays",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test",
    "seed": "node scripts/seed.mjs",
    "fetch": "node scripts/fetch.mjs",
    "validate": "node scripts/validate.mjs"
  }
}
```

- [ ] **Step 2: `.gitignore` 작성**

```
node_modules/
.env
```

- [ ] **Step 3: `.env.example` 작성**

```
# 공공데이터포털 특일정보 API — Decoding 키(날것)를 넣으세요. Encoding 키 금지.
DATA_GO_KR_KEY=
```

- [ ] **Step 4: `types.ts` 작성**

```ts
export enum DateKind {
  Holiday = 1,
  Anniversary = 2,
  SolarTerms = 3,
  Sundry = 4,
}

export interface DateInfo {
  date: string; // "YYYY-MM-DD"
  name: string;
  holiday: boolean;
  remarks: string | null;
  kind: DateKind;
  time: string | null; // "HH:mm" (절기)
  sunLng: number | null; // 절기 태양황경
}
```

- [ ] **Step 5: `public/.gitkeep` 빈 파일 생성** (seed 전까지 폴더 유지용)

- [ ] **Step 6: 스캐폴딩 검증**

Run: `node --test`
Expected: 테스트 파일이 없어 `tests 0` 로 종료 코드 0. (에러 없이 종료되면 통과)

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore .env.example types.ts public/.gitkeep
git commit -m "chore: 프로젝트 스캐폴딩 및 DateInfo 타입 정의"
```

---

## Task 2: 변환 로직 (`transform.mjs`)

API 원본 응답을 `DateInfo`로 바꾸는 순수 함수들. 네트워크 없음.

**Files:**
- Create: `scripts/lib/transform.mjs`
- Test: `scripts/lib/transform.test.mjs`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `formatDate(locdate: number|string): string` — 8자리 → "YYYY-MM-DD"
  - `formatTime(kst: string): string` — "HHMM" → "HH:mm"
  - `dateKindToKind(dateKind: string|number): 1|2|3|4`
  - `normalizeName(rawName, index: number, rawArray: any[]): string`
  - `extractItems(json: any): any[]`
  - `normalizeItem(raw, index: number, arr: any[]): DateInfo`
  - `normalizeResponse(json: any): DateInfo[]`

- [ ] **Step 1: 실패 테스트 작성** — `scripts/lib/transform.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDate, formatTime, dateKindToKind,
  normalizeName, extractItems, normalizeResponse,
} from "./transform.mjs";

test("formatDate: 8자리 숫자를 YYYY-MM-DD로", () => {
  assert.equal(formatDate(20260101), "2026-01-01");
  assert.equal(formatDate("20261225"), "2026-12-25");
});

test("formatTime: HHMM을 HH:mm으로", () => {
  assert.equal(formatTime("1723"), "17:23");
  assert.equal(formatTime(" 0905 "), "09:05");
});

test("dateKindToKind: 01~04 매핑", () => {
  assert.equal(dateKindToKind("01"), 1);
  assert.equal(dateKindToKind("03"), 3);
  assert.throws(() => dateKindToKind("09"));
});

test("normalizeName: 특수 케이스", () => {
  assert.equal(normalizeName("1월1일", 0, []), "새해");
  assert.equal(normalizeName("기독탄신일", 0, []), "크리스마스");
  const arr = [{ dateName: "어린이날" }, { dateName: "대체공휴일" }];
  assert.equal(normalizeName("대체공휴일", 1, arr), "어린이날 (대체공휴일)");
  assert.equal(normalizeName("삼일절", 0, []), "삼일절");
});

test("extractItems: item이 배열/객체/없음", () => {
  assert.deepEqual(extractItems({ response: { body: { items: { item: [{ a: 1 }] } } } }), [{ a: 1 }]);
  assert.deepEqual(extractItems({ response: { body: { items: { item: { a: 1 } } } } }), [{ a: 1 }]);
  assert.deepEqual(extractItems({ response: { body: { items: { item: "" } } } }), []);
  assert.deepEqual(extractItems({}), []);
});

test("normalizeResponse: 공휴일 항목", () => {
  const json = { response: { body: { items: { item: [
    { locdate: 20260101, dateName: "1월1일", isHoliday: "Y", dateKind: "01" },
  ] } } } };
  assert.deepEqual(normalizeResponse(json), [
    { date: "2026-01-01", name: "새해", holiday: true, remarks: null, kind: 1, time: null, sunLng: null },
  ]);
});

test("normalizeResponse: 절기(time/sunLng 포함)", () => {
  const json = { response: { body: { items: { item: [
    { locdate: 20260105, dateName: "소한", isHoliday: "N", dateKind: "03", kst: "1723", sunLongitude: 285 },
  ] } } } };
  assert.deepEqual(normalizeResponse(json), [
    { date: "2026-01-05", name: "소한", holiday: false, remarks: null, kind: 3, time: "17:23", sunLng: 285 },
  ]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test scripts/lib/transform.test.mjs`
Expected: FAIL — `Cannot find module './transform.mjs'` 또는 함수 미정의.

- [ ] **Step 3: 구현** — `scripts/lib/transform.mjs`

```js
const KIND_MAP = { "01": 1, "02": 2, "03": 3, "04": 4 };

export function formatDate(locdate) {
  return String(locdate)
    .padStart(8, "0")
    .replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
}

export function formatTime(kst) {
  return String(kst).trim().replace(/^(\d{2})(\d{2})$/, "$1:$2");
}

export function dateKindToKind(dateKind) {
  const kind = KIND_MAP[String(dateKind).padStart(2, "0")];
  if (!kind) throw new Error(`알 수 없는 dateKind: ${dateKind}`);
  return kind;
}

export function normalizeName(rawName, index, rawArray) {
  const name = String(rawName ?? "").normalize("NFC").trim();
  if (name === "1월1일") return "새해";
  if (name === "기독탄신일") return "크리스마스";
  if (name === "대체공휴일" && index > 0) {
    const prev = String(rawArray[index - 1]?.dateName ?? "").normalize("NFC").trim();
    return `${prev} (대체공휴일)`;
  }
  return name;
}

export function extractItems(json) {
  const item = json?.response?.body?.items?.item;
  if (Array.isArray(item)) return item;
  if (item == null || item === "") return [];
  return [item];
}

export function normalizeItem(raw, index, arr) {
  const hasTime = raw.kst != null && String(raw.kst).trim() !== "";
  const hasRemarks = raw.remarks != null && String(raw.remarks).trim() !== "";
  return {
    date: formatDate(raw.locdate),
    name: normalizeName(raw.dateName, index, arr),
    holiday: raw.isHoliday === "Y",
    remarks: hasRemarks ? String(raw.remarks).trim() : null,
    kind: dateKindToKind(raw.dateKind),
    time: hasTime ? formatTime(raw.kst) : null,
    sunLng: raw.sunLongitude != null && raw.sunLongitude !== "" ? Number(raw.sunLongitude) : null,
  };
}

export function normalizeResponse(json) {
  const items = extractItems(json);
  return items.map((raw, i) => normalizeItem(raw, i, items));
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test scripts/lib/transform.test.mjs`
Expected: PASS (전 테스트 통과).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/transform.mjs scripts/lib/transform.test.mjs
git commit -m "feat: API 응답 → DateInfo 변환 로직"
```

---

## Task 3: 병합 로직 (`merge.mjs`)

**Files:**
- Create: `scripts/lib/merge.mjs`
- Test: `scripts/lib/merge.test.mjs`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `keyOf(d: DateInfo): string` — `` `${date}|${kind}|${name}` ``
  - `sortDateInfos(arr: DateInfo[]): DateInfo[]` — date asc, 동일 시 kind asc (원본 불변)
  - `mergeDateInfos(existing: DateInfo[], incoming: DateInfo[]): DateInfo[]` — incoming 우선, local-only 보존, 정렬 반환

- [ ] **Step 1: 실패 테스트 작성** — `scripts/lib/merge.test.mjs`

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

test("mergeDateInfos: incoming이 collision에서 승리", () => {
  const existing = [di("2026-01-01", 1, "새해", { holiday: true, remarks: "old" })];
  const incoming = [di("2026-01-01", 1, "새해", { holiday: true, remarks: "new" })];
  const merged = mergeDateInfos(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].remarks, "new");
});

test("mergeDateInfos: local-only 항목 보존 + 신규 추가", () => {
  const existing = [di("2026-05-01", 2, "근로자의날")]; // API가 안 주는 수동 항목
  const incoming = [di("2026-03-01", 1, "삼일절", { holiday: true })];
  const merged = mergeDateInfos(existing, incoming);
  assert.deepEqual(merged.map((d) => d.name), ["삼일절", "근로자의날"]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test scripts/lib/merge.test.mjs`
Expected: FAIL — 모듈/함수 미정의.

- [ ] **Step 3: 구현** — `scripts/lib/merge.mjs`

```js
export function keyOf(d) {
  return `${d.date}|${d.kind}|${d.name}`;
}

export function sortDateInfos(arr) {
  return [...arr].sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    return a.kind - b.kind;
  });
}

export function mergeDateInfos(existing, incoming) {
  const map = new Map();
  for (const d of existing) map.set(keyOf(d), d);
  for (const d of incoming) map.set(keyOf(d), d);
  return sortDateInfos([...map.values()]);
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test scripts/lib/merge.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/merge.mjs scripts/lib/merge.test.mjs
git commit -m "feat: 날짜 기준 병합/정렬 로직"
```

---

## Task 4: 조회 범위 로직 (`range.mjs`)

**Files:**
- Create: `scripts/lib/range.mjs`
- Test: `scripts/lib/range.test.mjs`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `rollingMonths(baseDate: Date, count: number): {year:number, month:number}[]` — baseDate 달부터 count개월(연도 경계 처리)
  - `monthsOfYear(year: number): {year:number, month:number}[]` — 1~12월

- [ ] **Step 1: 실패 테스트 작성** — `scripts/lib/range.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { rollingMonths, monthsOfYear } from "./range.mjs";

test("rollingMonths: 3개월, 연도 안쪽", () => {
  assert.deepEqual(rollingMonths(new Date(2026, 6, 17), 3), [
    { year: 2026, month: 7 }, { year: 2026, month: 8 }, { year: 2026, month: 9 },
  ]);
});

test("rollingMonths: 연도 경계", () => {
  assert.deepEqual(rollingMonths(new Date(2026, 10, 1), 3), [
    { year: 2026, month: 11 }, { year: 2026, month: 12 }, { year: 2027, month: 1 },
  ]);
});

test("monthsOfYear: 12개월", () => {
  const out = monthsOfYear(2025);
  assert.equal(out.length, 12);
  assert.deepEqual(out[0], { year: 2025, month: 1 });
  assert.deepEqual(out[11], { year: 2025, month: 12 });
});
```

주의: `new Date(2026, 6, 17)`의 6은 0-based라 7월이다.

- [ ] **Step 2: 실패 확인**

Run: `node --test scripts/lib/range.test.mjs`
Expected: FAIL — 모듈/함수 미정의.

- [ ] **Step 3: 구현** — `scripts/lib/range.mjs`

```js
export function rollingMonths(baseDate, count) {
  const out = [];
  let year = baseDate.getFullYear();
  let month = baseDate.getMonth() + 1;
  for (let i = 0; i < count; i++) {
    out.push({ year, month });
    month++;
    if (month > 12) { month = 1; year++; }
  }
  return out;
}

export function monthsOfYear(year) {
  return Array.from({ length: 12 }, (_, i) => ({ year, month: i + 1 }));
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test scripts/lib/range.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/range.mjs scripts/lib/range.test.mjs
git commit -m "feat: 조회 범위(롤링/연간) 계산 로직"
```

---

## Task 5: API 클라이언트 (`api.mjs`)

특일정보 API를 월 단위로 조회하고 페이지네이션을 처리한다. 테스트는 `fetch`를 주입해 네트워크 없이 검증.

**Files:**
- Create: `scripts/lib/api.mjs`
- Test: `scripts/lib/api.test.mjs`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `OPERATIONS: string[]` — 5개 오퍼레이션명
  - `fetchOperation(op: string, year: number, month: number, key: string, fetchImpl=fetch): Promise<{response:{body:{items:{item:any[]}}}}>` — 전 페이지 병합해 `normalizeResponse`가 그대로 받을 수 있는 형태로 반환

- [ ] **Step 1: 실패 테스트 작성** — `scripts/lib/api.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { OPERATIONS, fetchOperation } from "./api.mjs";
import { normalizeResponse } from "./transform.mjs";

test("OPERATIONS: 5종 포함", () => {
  assert.deepEqual(OPERATIONS, [
    "getHoliDeInfo", "getRestDeInfo", "getAnniversaryInfo",
    "get24DivisionsInfo", "getSundryDayInfo",
  ]);
});

function mockRes(body) {
  return { ok: true, status: 200, json: async () => body };
}

test("fetchOperation: serviceKey를 URL 인코딩(1회)하고 solMonth 2자리 패딩", async () => {
  let calledUrl = "";
  const fetchImpl = async (url) => {
    calledUrl = url;
    return mockRes({ response: { header: { resultCode: "00" }, body: { totalCount: 0, items: { item: "" } } } });
  };
  await fetchOperation("getRestDeInfo", 2026, 1, "raw+key/with=chars", fetchImpl);
  assert.match(calledUrl, /serviceKey=raw%2Bkey%2Fwith%3Dchars/);
  assert.match(calledUrl, /solMonth=01/);
  assert.match(calledUrl, /solYear=2026/);
});

test("fetchOperation: 페이지네이션으로 totalCount만큼 수집", async () => {
  const page1 = { response: { header: { resultCode: "00" }, body: { totalCount: 3, numOfRows: 2, items: { item: [
    { locdate: 20260101, dateName: "1월1일", isHoliday: "Y", dateKind: "01" },
    { locdate: 20260301, dateName: "삼일절", isHoliday: "Y", dateKind: "01" },
  ] } } } };
  const page2 = { response: { header: { resultCode: "00" }, body: { totalCount: 3, numOfRows: 2, items: { item: {
    locdate: 20260505, dateName: "어린이날", isHoliday: "Y", dateKind: "01",
  } } } } };
  let call = 0;
  const fetchImpl = async () => mockRes(++call === 1 ? page1 : page2);
  const merged = await fetchOperation("getRestDeInfo", 2026, 1, "k", fetchImpl);
  assert.equal(normalizeResponse(merged).length, 3);
  assert.equal(call, 2);
});

test("fetchOperation: API 에러코드면 throw", async () => {
  const fetchImpl = async () => mockRes({ response: { header: { resultCode: "30", resultMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" } } });
  await assert.rejects(() => fetchOperation("getRestDeInfo", 2026, 1, "k", fetchImpl), /30/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test scripts/lib/api.test.mjs`
Expected: FAIL — 모듈/함수 미정의.

- [ ] **Step 3: 구현** — `scripts/lib/api.mjs`

```js
const BASE = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService";

export const OPERATIONS = [
  "getHoliDeInfo",
  "getRestDeInfo",
  "getAnniversaryInfo",
  "get24DivisionsInfo",
  "getSundryDayInfo",
];

export async function fetchOperation(op, year, month, key, fetchImpl = fetch) {
  const collected = [];
  let pageNo = 1;
  let total = Infinity;

  while (collected.length < total) {
    const params = new URLSearchParams({
      serviceKey: key,
      solYear: String(year),
      solMonth: String(month).padStart(2, "0"),
      numOfRows: "100",
      pageNo: String(pageNo),
      _type: "json",
    });
    const res = await fetchImpl(`${BASE}/${op}?${params}`);
    if (!res.ok) throw new Error(`${op} ${year}-${month} HTTP ${res.status}`);
    const json = await res.json();

    const code = json?.response?.header?.resultCode;
    if (code && code !== "00") {
      throw new Error(`${op} ${year}-${month} API 오류 ${code}: ${json?.response?.header?.resultMsg}`);
    }

    const body = json?.response?.body ?? {};
    const item = body?.items?.item;
    const arr = Array.isArray(item) ? item : item == null || item === "" ? [] : [item];
    collected.push(...arr);

    total = Number(body.totalCount ?? collected.length);
    if (arr.length === 0) break;
    pageNo++;
  }

  return { response: { body: { items: { item: collected } } } };
}
```

주의: `URLSearchParams`가 Decoding 키의 `+ / =`를 `%2B %2F %3D`로 1회 인코딩한다(Global Constraints의 키 규칙 충족).

- [ ] **Step 4: 통과 확인**

Run: `node --test scripts/lib/api.test.mjs`
Expected: PASS.

- [ ] **Step 5: 전체 단위 테스트 확인**

Run: `node --test`
Expected: transform/merge/range/api 전 테스트 PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/api.mjs scripts/lib/api.test.mjs
git commit -m "feat: 특일정보 API 클라이언트(페이지네이션)"
```

---

## Task 6: 초기 시드 (`seed.mjs`)

원본 distbe/holidays의 2004~2026 데이터를 내려받아 우리 정렬 규칙으로 정규화해 `public/`에 저장한다.

**Files:**
- Create: `scripts/seed.mjs`
- Generated: `public/2004.json`~`public/2026.json`, `public/index.json`
- Delete: `public/.gitkeep` (실데이터 생성 후 불필요)

**Interfaces:**
- Consumes: `sortDateInfos` (Task 3)
- Produces: `public/{year}.json`(DateInfo[]), `public/index.json`({years, updatedAt})

- [ ] **Step 1: 구현** — `scripts/seed.mjs`

```js
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
```

- [ ] **Step 2: 실행 (네트워크 필요)**

Run: `node scripts/seed.mjs`
Expected: "시드 완료 2004.json ... 2026.json", 마지막에 index.json 작성 로그. 네트워크 필요.

- [ ] **Step 3: 결과 검증**

Run: `ls public/*.json | wc -l && node -e "const a=require('fs').readFileSync('public/2026.json','utf8');const j=JSON.parse(a);console.log('2026 entries:',j.length);console.log(j.find(d=>d.date==='2026-01-01'))"`
Expected: 파일 24개(2004~2026 + index.json). `2026-01-01`이 `새해`, `holiday:true`, `kind:1`.

- [ ] **Step 4: .gitkeep 제거 및 Commit**

```bash
rm -f public/.gitkeep
git add scripts/seed.mjs public/
git rm --cached public/.gitkeep 2>/dev/null || true
git commit -m "feat: 초기 시드 스크립트 + 2004~2026 데이터"
```

---

## Task 7: 오케스트레이션 (`fetch.mjs`)

범위를 결정해 API 조회 → 변환 → 병합 → `public/{year}.json` 쓰기, `index.json` 갱신.

**Files:**
- Create: `scripts/fetch.mjs`

**Interfaces:**
- Consumes: `OPERATIONS`, `fetchOperation` (Task 5), `normalizeResponse` (Task 2), `mergeDateInfos` (Task 3)
- Produces: CLI 엔트리. 환경변수 `DATA_GO_KR_KEY`(필수), `FETCH_YEAR`(선택), `FETCH_MONTH`(선택). 없으면 3개월 롤링.

- [ ] **Step 1: 구현** — `scripts/fetch.mjs`

```js
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
```

- [ ] **Step 2: `.env`에 키 넣기 (사용자 직접, 1회)**

Run: `printf 'DATA_GO_KR_KEY=%s\n' '여기에_디코딩키' > .env`
(`.env`는 `.gitignore`에 있으므로 커밋되지 않는다.)

- [ ] **Step 3: 신규 연도 생성 검증 — end-to-end**

Run: `FETCH_YEAR=2027 FETCH_MONTH=1 node --env-file=.env scripts/fetch.mjs`
Expected: "조회 범위: 2027-01", "2027.json: N건" 로그. 이어서:

Run: `node -e "const j=require('fs').readFileSync('public/2027.json','utf8');const a=JSON.parse(j);console.log(a.find(d=>d.date==='2027-01-01'))"`
Expected: `2027-01-01`이 `새해`/`holiday:true`/`kind:1`로 생성됨. (API가 2027을 제공하지 않으면 빈 배열일 수 있음 → 그 경우 Step 4로.)

- [ ] **Step 4: 검증용 산출물 되돌리기**

Run: `git checkout -- public/index.json 2>/dev/null; rm -f public/2027.json`
(2027은 전체 시드 대상이 아니므로 검증 후 제거. 실제 추가는 백필 워크플로우로 한다.)

- [ ] **Step 5: 멱등성 검증 — 시드된 달 재조회 시 과다 변경 없음**

Run: `FETCH_YEAR=2026 FETCH_MONTH=1 node --env-file=.env scripts/fetch.mjs && git status --short public/2026.json`
Expected: `public/2026.json`에 변경이 없거나(멱등) 소수의 실제 데이터 차이만 발생. `git diff public/2026.json`로 차이를 확인해 정상 데이터(remarks 추가 등)인지 검토. 대량 재정렬/중복이 보이면 transform/merge 버그이므로 Task 2/3을 재점검.

- [ ] **Step 6: 검증용 변경 되돌리기 후 Commit (fetch.mjs만)**

```bash
git checkout -- public/2026.json public/index.json 2>/dev/null || true
git add scripts/fetch.mjs
git commit -m "feat: fetch 오케스트레이션(범위 조회→변환→병합→쓰기)"
```

---

## Task 8: 검증 스크립트 (`validate.mjs`)

**Files:**
- Create: `scripts/validate.mjs`

**Interfaces:**
- Consumes: `keyOf` (Task 3)
- Produces: CLI. 이상 발견 시 목록 출력 후 `exit 1`, 정상 시 `exit 0`.

- [ ] **Step 1: 구현** — `scripts/validate.mjs`

```js
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
```

- [ ] **Step 2: 시드 데이터로 통과 확인**

Run: `node scripts/validate.mjs`
Expected: `검증 통과: 연도 파일 23개`.

- [ ] **Step 3: 실패 동작 확인 (일시적 손상 주입)**

Run: `node -e "const f='public/2026.json';const fs=require('fs');const a=JSON.parse(fs.readFileSync(f));a.push(a[0]);fs.writeFileSync(f,JSON.stringify(a,null,2)+'\n')" && node scripts/validate.mjs; echo "exit=$?"`
Expected: 중복/정렬 오류 출력 + `exit=1`.

- [ ] **Step 4: 손상 복구**

Run: `git checkout -- public/2026.json`
Expected: 되돌려짐. 확인: `node scripts/validate.mjs` → 통과.

- [ ] **Step 5: Commit**

```bash
git add scripts/validate.mjs
git commit -m "feat: public JSON 검증 스크립트"
```

---

## Task 9: GitHub Actions 워크플로우

**Files:**
- Create: `.github/workflows/update.yml`, `.github/workflows/backfill.yml`

**Interfaces:**
- Consumes: `scripts/fetch.mjs`, `scripts/validate.mjs`, Secret `DATA_GO_KR_KEY`
- Produces: 자동/수동 PR 생성 파이프라인

- [ ] **Step 1: `.github/workflows/update.yml` 작성**

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
      - name: 검증
        run: node scripts/validate.mjs
      - name: PR 생성
        uses: peter-evans/create-pull-request@v6
        with:
          branch: auto/holidays-update
          title: "chore: 공휴일 데이터 자동 갱신"
          commit-message: "chore: 공휴일 데이터 자동 갱신"
          body: |
            공공데이터포털 특일정보 API 자동 조회 결과입니다(이번 달~다다음 달).
            변경된 날짜를 확인 후 머지하세요.
          delete-branch: true
```

- [ ] **Step 2: `.github/workflows/backfill.yml` 작성**

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
      - name: 검증
        run: node scripts/validate.mjs
      - name: PR 생성
        uses: peter-evans/create-pull-request@v6
        with:
          branch: auto/holidays-backfill-${{ inputs.year }}
          title: "chore: 공휴일 백필 ${{ inputs.year }}${{ inputs.month && format('-{0}', inputs.month) || '' }}"
          commit-message: "chore: 공휴일 백필 ${{ inputs.year }}"
          body: |
            수동 백필 결과입니다 (연도: ${{ inputs.year }}, 월: ${{ inputs.month || '전체' }}).
            변경된 날짜를 확인 후 머지하세요.
          delete-branch: true
```

- [ ] **Step 3: YAML 구문 검증**

Run: `node -e "for(const f of ['.github/workflows/update.yml','.github/workflows/backfill.yml']){const s=require('fs').readFileSync(f,'utf8');if(!/jobs:/.test(s)||!/peter-evans\/create-pull-request/.test(s))throw new Error('malformed '+f);}console.log('workflows OK')"`
Expected: `workflows OK`. (본격 lint는 push 후 GitHub가 수행.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/update.yml .github/workflows/backfill.yml
git commit -m "ci: 자동 갱신/수동 백필 워크플로우 추가"
```

---

## Task 10: README + 마무리

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: 없음
- Produces: 사용법 문서

- [ ] **Step 1: `README.md` 작성 (기존 내용 전체 교체)**

````markdown
# holidays

한국 공휴일·기념일·24절기·잡절 데이터를 연도별 JSON으로 관리하고 CDN으로 배포합니다.
데이터 출처: 공공데이터포털 "한국천문연구원_특일 정보".

## 사용 (CDN)

```
https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/{year}.json
https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/index.json
```

예: `https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/2026.json`

> `@main`은 캐시가 최대 12~24h입니다. 즉시 반영이 필요하면 git 태그를 찍고 `@v1.0.0`처럼 버전을 지정하세요.

## 데이터 스키마

```ts
interface DateInfo {
  date: string;        // "YYYY-MM-DD"
  name: string;
  holiday: boolean;    // 법정공휴일 여부
  remarks: string | null;
  kind: 1 | 2 | 3 | 4; // 1=공휴일 2=기념일 3=절기 4=잡절
  time: string | null; // 절기만 "HH:mm"
  sunLng: number | null;
}
```

`index.json`: `{ "years": number[], "updatedAt": string }`

## 로컬 개발

```bash
# 1) API 키 준비 — Decoding 키(날것)를 넣습니다. Encoding 키 금지.
cp .env.example .env && vi .env   # DATA_GO_KR_KEY=...

# 2) 초기 데이터 시드 (원본에서 2004~2026 복사)
npm run seed

# 3) 특일정보 조회 (기본: 이번 달~다다음 달)
node --env-file=.env scripts/fetch.mjs
# 특정 연/월: FETCH_YEAR=2027 FETCH_MONTH=1 node --env-file=.env scripts/fetch.mjs

# 4) 검증 / 테스트
npm run validate
npm test
```

## 자동화 (GitHub Actions)

- **공휴일 자동 갱신** (`update.yml`): 매일 KST 09시 → 이번 달~다다음 달 조회 → 변경 시 PR 생성.
- **공휴일 수동 백필** (`backfill.yml`): Actions 탭에서 연/월 지정해 수동 실행 → PR 생성.
- 두 워크플로우 모두 `main`에 직접 커밋하지 않고 **PR로만** 올립니다. diff 확인 후 머지하세요.

### 설정
저장소 **Settings → Secrets and variables → Actions → New repository secret**:
- Name: `DATA_GO_KR_KEY`
- Value: 공공데이터포털 **Decoding 키**

## 병합 규칙
자동 조회는 `date|kind|name` 키 기준으로 병합합니다. API가 준 항목은 API 값으로 갱신되고,
로컬에만 있는 수동 항목은 보존됩니다. (API의 항목 삭제는 자동 반영되지 않으므로 필요 시 수동 삭제)
````

- [ ] **Step 2: 최종 전체 검증**

Run: `npm test && npm run validate`
Expected: 전 단위 테스트 PASS + `검증 통과`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README 사용법/CDN/자동화 안내"
```

---

## 배포 후 수동 절차 (구현 완료 후, 사용자 실행)

- [ ] GitHub 저장소 Settings에 Secret `DATA_GO_KR_KEY`(Decoding 키) 등록
- [ ] `git push origin main`
- [ ] CDN 확인: `curl -s https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/2026.json | head`
- [ ] Actions 탭에서 `공휴일 자동 갱신` 수동 1회 실행해 PR 생성/머지 흐름 점검

---

## Self-Review 결과

- **Spec 커버리지:** 스키마(T1,T2), 데이터 소스/키 규칙(T5), 시드(T6), 3개월 롤링·백필 범위(T4,T7,T9), 병합 전략(T3), 검증(T8), 배포/CDN(T10), 자동화 하이브리드 PR(T9) — 스펙 각 섹션에 대응 태스크 존재.
- **플레이스홀더:** 없음(모든 스텝에 실제 코드/명령/기대값 기재). `.env`의 키 값만 사용자 입력.
- **타입 일관성:** `keyOf`/`sortDateInfos`/`mergeDateInfos`(T3), `normalizeResponse`(T2), `fetchOperation`/`OPERATIONS`(T5), `rollingMonths`/`monthsOfYear`(T4) 이름·시그니처가 소비처(T6,T7,T8)와 일치.
