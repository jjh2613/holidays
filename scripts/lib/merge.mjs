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

// auto 레이어 병합: API(incoming)가 진실의 원천 → 같은 키(keyOf)는 incoming이 승리.
export function mergeDateInfos(existing, incoming) {
  const map = new Map();
  for (const d of existing) map.set(keyOf(d), d);
  for (const d of incoming) map.set(keyOf(d), d);
  return sortDateInfos([...map.values()]);
}
