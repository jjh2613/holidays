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
