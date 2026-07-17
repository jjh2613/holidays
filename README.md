# holidays

[![jsDelivr](https://img.shields.io/badge/CDN-jsDelivr-orange)](https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/index.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

한국의 **공휴일·기념일·24절기·잡절** 데이터를 연도별 JSON으로 관리하고 CDN으로 배포하는 프로젝트입니다.
서버·빌드 없이 [jsDelivr](https://www.jsdelivr.com/) CDN에서 바로 가져다 쓸 수 있습니다.

- 📅 2004~2026년 데이터 수록 (`public/{year}.json`)
- 🔄 공공데이터포털 특일정보 API로 자동 갱신 (매일, PR로 검토 후 반영)
- 📦 런타임 의존성 0 — Node.js 22 내장 기능만 사용
- 🧩 소비자용 타입 정의 제공 (`types.ts`)

## 빠른 시작

CDN URL에서 연도별 JSON을 가져옵니다. 인증·API 키 불필요.

```
https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/{year}.json
https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/index.json
```

```js
const res = await fetch("https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/2026.json");
const dates = await res.json();

// 2026년 법정공휴일만
const holidays = dates.filter((d) => d.holiday);
```

`index.json`으로 사용 가능한 연도 목록을 먼저 확인할 수 있습니다.

```js
const { years, updatedAt } = await fetch(
  "https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/index.json"
).then((r) => r.json());
```

> **캐시 주의**: `@main`은 jsDelivr 캐시가 최대 12~24시간 유지됩니다.
> 즉시 반영이 필요하면 git 태그를 만들고 `@v1.0.0`처럼 버전을 지정하세요.

## 데이터 스키마

각 `public/{year}.json`은 `DateInfo[]` 배열이며, `date` → `kind` 순으로 정렬됩니다.

```ts
interface DateInfo {
  date: string;        // "YYYY-MM-DD"
  name: string;        // 예: "새해"
  holiday: boolean;    // 법정공휴일 여부
  remarks: string | null;
  kind: 1 | 2 | 3 | 4; // 아래 표 참고
  time: string | null; // 절기만 "HH:mm"
  sunLng: number | null;
}
```

| `kind` | 의미 | 예 |
| :----: | ---- | --- |
| 1 | 공휴일 | 새해, 삼일절, 추석 |
| 2 | 기념일 | 식목일, 스승의 날 |
| 3 | 24절기 | 입춘, 하지 (`time`·`sunLng` 포함) |
| 4 | 잡절 | 단오, 초복 |

`index.json`: `{ "years": number[], "updatedAt": string }`

## 로컬 개발

Node.js 22 이상이 필요합니다. 외부 npm 의존성은 없습니다.

```bash
# 1) API 키 준비 — 공공데이터포털 Decoding 키(날것)를 넣습니다. Encoding 키는 넣지 마세요.
cp .env.example .env && $EDITOR .env   # DATA_GO_KR_KEY=...

# 2) 초기 데이터 시드 (distbe/holidays에서 2004~2026 복사)
npm run seed

# 3) 특일정보 조회 (기본: 이번 달~다다음 달, 3개월 롤링)
node --env-file=.env scripts/fetch.mjs
# 특정 연/월만: FETCH_YEAR=2027 FETCH_MONTH=1 node --env-file=.env scripts/fetch.mjs

# 4) 검증 / 테스트
npm run validate
npm test
```

> **API 키 주의**: 공공데이터포털은 Encoding 키와 Decoding 키를 함께 발급합니다.
> 이 프로젝트는 **Decoding 키(날것)** 를 저장하고 코드가 1회만 URL 인코딩합니다.
> Encoding 키를 넣으면 이중 인코딩으로 `401`이 발생합니다.

## 자동화 (GitHub Actions)

- **공휴일 자동 갱신** (`.github/workflows/update.yml`): 매일 KST 09시 → 이번 달~다다음 달 조회 → 변경 시 PR 생성.
- **공휴일 수동 백필** (`.github/workflows/backfill.yml`): Actions 탭에서 연/월을 지정해 수동 실행 → PR 생성.

두 워크플로우 모두 `main`에 직접 커밋하지 않고 **PR로만** 올립니다. diff를 확인한 뒤 머지하세요.

### 설정

1. **Secret 등록** — 저장소 **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `DATA_GO_KR_KEY`
   - Value: 공공데이터포털 **Decoding 키**
2. **PR 생성 권한 허용** — **Settings → Actions → General → Workflow permissions**
   - "Allow GitHub Actions to create and approve pull requests" 체크

## 병합 규칙

자동 조회는 `date|kind|name` 키를 기준으로 기존 데이터와 병합합니다.

- 로컬에 없는 API 항목은 **새로 추가**됩니다 (임시공휴일 등).
- 이미 로컬에 있는 항목은 **그대로 유지**됩니다 — 수동으로 수정한 값이 자동 조회로 덮어써지지 않습니다.
- API에서 항목이 사라져도 **자동 삭제하지 않습니다**. 필요 시 직접 삭제하세요.

즉, **수동 편집이 항상 우선**입니다. 자동화는 누락 방지용 보조 수단입니다.

## 데이터 출처

- 원본 데이터: 공공데이터포털 [한국천문연구원_특일 정보](https://www.data.go.kr/data/15012690/openapi.do)
- 시드 및 구조 참고: [distbe/holidays](https://github.com/distbe/holidays)

## 기여

이슈와 PR을 환영합니다. 데이터 오류 제보 시 해당 `날짜 / 이름 / 연도 파일`을 함께 적어 주세요.
PR 전에 `npm run validate`와 `npm test`가 통과하는지 확인해 주세요.

## 라이선스

[MIT](./LICENSE) — 코드 및 이 저장소의 구성물.
원본 특일 데이터의 이용 조건은 공공데이터포털의 이용허락범위를 따릅니다.
