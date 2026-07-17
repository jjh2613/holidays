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
