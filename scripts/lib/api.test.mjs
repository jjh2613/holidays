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
