import { sortDateInfos } from "./merge.mjs";

export function groupKey(d) {
  return `${d.date}|${d.kind}`;
}

// public = auto + manual. groupKey(date|kind) 단위로 manual이 auto를 통째 대체.
// manual에 존재하는 그룹의 auto 항목은 버리고, 남은 auto + 전체 manual을 정렬한다.
export function buildPublic(auto, manual) {
  const claimed = new Set(manual.map(groupKey));
  const kept = auto.filter((d) => !claimed.has(groupKey(d)));
  return sortDateInfos([...kept, ...manual]);
}
