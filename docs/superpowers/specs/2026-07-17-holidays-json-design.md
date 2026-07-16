# 공휴일 JSON 배포 시스템 설계

작성일: 2026-07-17

## 목적

한국 공휴일·기념일·24절기·잡절 데이터를 연도별 JSON으로 관리하고, 별도 서버·빌드 없이
public URL(CDN)로 배포한다. [distbe/holidays](https://github.com/distbe/holidays)를
참고하되, 운영 방식은 **하이브리드**(자동 조회 + 수동 머지)로 한다.

## 배경 / 참고

- 원본(distbe/holidays)은 공공데이터포털 특일정보 API를 주기적으로 조회해 `public/{year}.json`을
  자동 갱신하고, GitHub Pages + jsDelivr로 배포한다.
- 한국은 임시공휴일(선거일, 정부 지정 임시공휴일 등)이 갑자기 추가되므로 순수 수동 관리는 누락 위험이 크다.
  → 자동 조회는 유지하되, 최종 반영은 사람이 PR로 통제한다.

## 데이터 소스

- **한국천문연구원 특일정보 API** (공공데이터포털, 자동승인, 개발계정 일 10,000회)
  - `getRestDeInfo` — 공휴일 + 대체공휴일
  - `getHoliDeInfo` — 국경일/공휴일
  - `getAnniversaryInfo` — 기념일
  - `get24DivisionsInfo` — 24절기
  - `getSundryDayInfo` — 잡절
- 조회는 연/월 단위, `_type=json`.
- **인증키 규칙**: 저장은 **Decoding 키(날것)**, 코드에서 `encodeURIComponent`로 1회 인코딩해 사용.
  Encoding 키를 넣으면 이중 인코딩(`%2B`→`%252B`)으로 401 발생.
  - 로컬: `.env`의 `DATA_GO_KR_KEY`
  - CI: GitHub Secret `DATA_GO_KR_KEY`

## 데이터 스키마

각 `public/{year}.json`은 `DateInfo[]` 배열이며 `date` → `kind` 순으로 정렬한다.

```ts
interface DateInfo {
  date: string;          // "YYYY-MM-DD"
  name: string;          // 예: "새해"
  holiday: boolean;      // 법정공휴일 여부
  remarks: string | null;
  kind: 1 | 2 | 3 | 4;   // 1=공휴일 2=기념일 3=절기 4=잡절
  time: string | null;   // 절기만 "HH:mm"
  sunLng: number | null; // 절기 태양황경(있으면)
}
```

`public/index.json` — 사용 가능한 연도 목록 메타데이터(예: `{ "years": [2004, ..., 2026], "updatedAt": "..." }`).

## 저장소 구조

```
holidays/
├── public/
│   ├── 2004.json ~ 2026.json   # 연도별 데이터
│   └── index.json               # 연도 목록 메타
├── scripts/
│   ├── seed.mjs                 # 최초 1회: 원본 gh-pages에서 2004~2026 복사
│   ├── fetch.mjs                # 특일정보 API 조회 → JSON 병합
│   └── validate.mjs             # 포맷·중복·정렬 검증
├── .github/workflows/
│   └── update.yml               # cron 매일 → fetch → 변경시 PR 생성
├── types.ts                     # 소비자용 타입 정의
├── .env.example                 # DATA_GO_KR_KEY=
├── .gitignore                   # .env 제외
└── README.md                    # 사용법 + CDN URL
```

**빌드·서버 없음.** 데이터 반영은 `public/*.json` 편집/머지가 전부.

## 초기 데이터 (시드)

- 2004~2026 초기 데이터는 **원본 gh-pages에서 복사**(`seed.mjs`) — API 호출 절약, 빠름.
- 소스: `https://cdn.jsdelivr.net/gh/distbe/holidays@gh-pages/{year}.json`

## 병합 전략 (자동 fetch 시)

날짜 기준 병합으로 **수동 수정을 보존**한다.

- 병합 키: `date` + `kind` + `name` 조합
- API가 준 키 → **API 값으로 갱신** (임시공휴일 추가, `holiday`/`remarks`/`time` 변경 반영)
- 로컬에만 있고 API가 안 준 키 → **그대로 보존** (수동 추가/수정 유지)
- 병합 후 `date` → `kind` 순 정렬
- 참고 한계: API가 항목을 "삭제"한 경우(예: 임시공휴일 취소)는 자동 감지하지 않으며, 필요 시 수동 삭제.

## 자동 조회 범위 (효율성)

- 자동 fetch는 **올해 + 내년**만 조회한다. 임시공휴일은 최근 연도에만 발생하므로 충분하고 API 호출을 절약한다.
- 과거 연도는 시드 이후 고정(필요 시 수동 재조회).

## 배포

jsDelivr가 GitHub 저장소를 그대로 CDN 서빙한다(서버·빌드·워크플로우 불필요).

```
https://cdn.jsdelivr.net/gh/<user>/holidays@main/public/{year}.json
```

- `@main`은 캐시가 최대 12~24h 유지된다. 즉시 반영이 필요하면 편집 후 git 태그(릴리스)를 찍고
  `@v1.2.0` 같은 버전 URL을 사용한다. README에 안내.

## 자동화 워크플로우 (하이브리드)

`.github/workflows/update.yml`

- **트리거**: `schedule` cron `0 0 * * *` (UTC 0시 = KST 09시) + `workflow_dispatch`(수동)
- **단계**:
  1. `actions/checkout`
  2. `actions/setup-node`
  3. `node scripts/fetch.mjs` — Secret `DATA_GO_KR_KEY`로 올해·내년 조회 → JSON 병합
  4. `node scripts/validate.mjs` — 검증 실패 시 중단
  5. `peter-evans/create-pull-request` — 변경분 있으면 PR 생성, 없으면 조용히 종료
- **통제**: `main` 직접 커밋 금지. **PR로만** 올리고 사람이 diff 확인 후 머지.
- PR 본문에 변경된 날짜 요약(추가/변경 항목)을 기입.

## 검증 (validate.mjs)

- `date` 포맷 `YYYY-MM-DD` 유효성
- 동일 `date`+`kind`+`name` 중복 탐지
- `kind` 값 1~4 범위
- 배열 정렬 상태(`date`→`kind`) 확인
- 실패 시 non-zero exit → CI 및 로컬 pre-commit 방어

## 범위 밖 (YAGNI)

- npm 패키지 배포(@kokr/date 유사) — 필요 시 추후.
- 조회 API 서버 / 커스텀 도메인 — jsDelivr로 충분.
- API의 항목 삭제 자동 반영.

## 열린 항목 / 확인 필요

- 소비 편의를 위한 `index.json` 필드 구성(연도 목록 외 최신 갱신일 포함 여부).
- cron 시각(현재 KST 09시)이 적절한지.
