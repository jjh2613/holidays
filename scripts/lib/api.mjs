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
    let res;
    try {
      res = await fetchImpl(`${BASE}/${op}?${params}`);
    } catch (e) {
      throw new Error(`${op} ${year}-${month} 네트워크 오류: ${e.message}`);
    }
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
