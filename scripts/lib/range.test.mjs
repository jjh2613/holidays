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
