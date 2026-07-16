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
