# 공휴일 JSON — auto/manual 레이어 분리 설계

작성일: 2026-07-17 (기존 [2026-07-17-holidays-json-design.md](./2026-07-17-holidays-json-design.md) 개정)

## 목적

수동 편집과 자동 조회를 **별도 파일 레이어로 분리**해, 수동 관리를 안전하고 추적 가능하게 만든다.
기존 구조는 자동(API)과 수동 편집이 같은 `public/{year}.json`에 섞여 다음 문제가 있었다.

- **이름 변경**: 수동으로 이름을 바꾸면 병합 키(`date|kind|name`)가 달라져 자동 항목과 **중복 행**이 생김.
- **삭제 부활**: 수동으로 지운 항목을 자동 조회가 조회 범위 안에서 다시 **되살림**.
- **추적 불가**: 어떤 값이 정부가 준 것인지 사람이 바꾼 것인지 구분 불가.

## 3-레이어 구조

```
auto/{year}.json     DateInfo[]           fetch.mjs만 씀 (API 원본). 손으로 편집하지 않음.
manual/{year}.json   DateInfo[]           사람이 씀 (추가·수정). 파일 없으면 [] 취급.
public/{year}.json   DateInfo[]           build가 auto+manual 병합해 생성. CDN이 서빙.
public/index.json    {years, updatedAt}   build가 생성.
```

- 세 레이어 모두 git에 커밋 → GitHub/CDN에서 **각각 조회 가능**.
- 소비자 CDN URL은 **`public/{year}.json` 그대로 유지**(하위호환).
- `manual/`은 사람용 디렉터리. 오버라이드가 없는 연도는 파일이 없어도 됨.

## 데이터 스키마

세 레이어 모두 동일한 `DateInfo[]`이며 `public`은 `date` → `kind` 순 정렬.

```ts
interface DateInfo {
  date: string;          // "YYYY-MM-DD"
  name: string;
  holiday: boolean;
  remarks: string | null;
  kind: 1 | 2 | 3 | 4;   // 1=공휴일 2=기념일 3=절기 4=잡절
  time: string | null;
  sunLng: number | null;
}
```

## 병합 규칙

### public = build(auto, manual) — 그룹 교체, 수동 우선

병합 단위는 `groupKey = ${date}|${kind}` (이름 제외).

- manual에 어떤 `groupKey` 그룹이 **있으면** → auto의 그 그룹 항목은 버리고 **manual 항목으로 통째 대체**.
- manual에 **없으면** → auto 그대로 통과.
- 남은 auto + 전체 manual → `date` → `kind` 정렬.
- **삭제 미지원**: auto 단독 항목을 완전히 제거하는 수단은 없다(YAGNI). 필요해지면 remove 목록을 추후 도입.
- 이름 변경/오버라이드: 해당 `date|kind` 그룹의 항목을 manual에 (필요하면 여러 건 모두) 적으면 auto 그룹을 대체하므로 중복이 생기지 않는다.

### auto = merge(기존 auto, API 조회분) — 키 병합, API(incoming) 우선

`fetch.mjs`가 auto에 병합할 때는 API가 진실의 원천이므로 **incoming 우선**.

- 병합 키: `keyOf = ${date}|${kind}|${name}`.
- 같은 키 → **API 값으로 갱신**. 조회 범위 밖 기존 항목 → 보존. 새 키 → 추가.
- (기존 구현이 local-wins였던 것을 incoming-wins로 되돌린다. 이제 수동 보존은 manual 레이어가 담당하므로 auto는 순수 API를 반영.)

## 스크립트

| 스크립트 | 역할 |
| --- | --- |
| `scripts/lib/merge.mjs` | `keyOf`, `sortDateInfos`, `mergeDateInfos`(incoming-wins) |
| `scripts/lib/build.mjs` | `groupKey`, `buildPublic(auto, manual)` |
| `scripts/build.mjs` **(신규)** | `auto/`+`manual/` → `public/{year}.json` + `public/index.json` 생성 (`npm run build`) |
| `scripts/fetch.mjs` | API 조회 → `auto/{year}.json`에만 병합 (index는 쓰지 않음 — build 담당) |
| `scripts/validate.mjs` | auto/manual/public 스키마 검증 + `public`이 `build(auto,manual)`과 일치(최신)하는지 검증 |
| ~~`scripts/seed.mjs`~~ | **삭제**. distbe 재조회 불필요(데이터는 이미 커밋됨). |

`build`는 auto와 manual에 존재하는 **연도의 합집합**을 순회한다(순수 manual 연도도 생성).

## 자동화 워크플로우

`update.yml`(cron+수동), `backfill.yml`(수동) 모두 단계에 **build 추가**:

```
fetch → build → validate → PR
```

PR에는 `auto/` 변경과 그 결과인 `public/` 변경이 함께 나타난다. `main` 직접 커밋 없이 PR로만.

## 마이그레이션

distbe 재조회 없이 기존 커밋 데이터를 이동만 한다.

1. `public/{year}.json` (23개) → `auto/{year}.json`로 `git mv`.
2. 기존 `public/index.json` 삭제(build가 재생성).
3. `manual/` 디렉터리 스캐폴드(`.gitkeep` + 사용법 README).
4. `npm run build` → `public/` 재생성. 초기엔 manual이 비어 있어 `public == auto`.
5. `npm run validate` 통과 확인.

## 검증 (validate.mjs)

- auto/manual/public 각 `{year}.json`: 배열, 요소는 객체, `date` 포맷·연도 소속, `kind` 1~4, `name` 비어있지 않은 문자열, `holiday` boolean.
- public: `date`→`kind` 정렬, `keyOf` 완전 중복 없음.
- **무결성**: auto∪manual의 각 연도에 대해 `buildPublic`을 다시 계산해 `public/{year}.json`과 바이트 동일한지 확인. 다르면 "public이 최신이 아님(`npm run build` 필요)".
- `public/index.json`의 `years`가 실제 public 파일 목록과 일치.
- 실패 시 non-zero exit.

## 배포 / 데이터 출처

- 배포: 변경 없음 — jsDelivr가 `public/{year}.json`을 서빙.
- 데이터 출처: 공공데이터포털 "한국천문연구원_특일 정보"만 표기. **distbe 참조 제거.**

## 범위 밖 (YAGNI)

- auto 단독 항목 삭제(remove 목록) — 필요 시 추후.
- manual 정렬 강제(build가 정렬하므로 불필요).
- npm 패키지 배포, 조회 API 서버.
