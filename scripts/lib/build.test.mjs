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
