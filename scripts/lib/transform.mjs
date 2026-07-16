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
