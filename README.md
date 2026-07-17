# holidays

[![jsDelivr](https://img.shields.io/badge/CDN-jsDelivr-orange)](https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/index.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

한국의 **공휴일·기념일·24절기·잡절** 데이터를 연도별 JSON으로 관리하고 CDN으로 배포하는 프로젝트입니다.
서버·빌드 없이 [jsDelivr](https://www.jsdelivr.com/) CDN에서 바로 가져다 쓸 수 있습니다.

- 📅 2004~2026년 데이터 수록 (`public/{year}.json`)
- 🔄 공공데이터포털 특일정보 API로 자동 갱신 (매일, PR로 검토 후 반영)
- ✍️ 자동(`auto/`)·수동(`manual/`) 레이어 분리 — 수동 편집이 자동 조회에 덮이지 않음
- 📦 런타임 의존성 0 — Node.js 22 내장 기능만 사용

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

> **캐시 주의**: `@main`은 jsDelivr 캐시가 최대 12~24시간 유지됩니다.
> 즉시 반영이 필요하면 git 태그를 만들고 `@v1.0.0`처럼 버전을 지정하세요.

### 배포처(미러)

같은 데이터를 여러 CDN에서 서빙합니다. 한 곳이 장애여도 다른 URL로 대체할 수 있습니다.

| 배포처 | URL |
| --- | --- |
| jsDelivr (기본) | `https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/{year}.json` |
| GitHub Pages | `https://jjh2613.github.io/holidays/{year}.json` |
| statically.io | `https://cdn.statically.io/gh/jjh2613/holidays/main/public/{year}.json` |

- **GitHub Pages**는 `public/`을 사이트 루트로 배포하므로 경로에 `public/`이 없습니다. `index.json`도 `https://jjh2613.github.io/holidays/index.json`으로 접근합니다.
- **statically.io**는 저장소 경로를 그대로 미러링하므로 `public/`이 경로에 포함됩니다. 별도 설정 없이 바로 사용 가능합니다.

## 데이터 레이어

```
auto/{year}.json     API 자동 조회 결과. 손으로 편집하지 않습니다.
manual/{year}.json   사람이 관리하는 오버라이드(추가·수정). 없으면 비어 있음 취급.
public/{year}.json   auto + manual 병합 결과. CDN이 서빙합니다. (build가 생성)
```

셋 다 저장소에 커밋되어 GitHub/CDN에서 각각 확인할 수 있습니다. 소비자는 **`public/`만** 쓰면 됩니다.

## 데이터 스키마

세 레이어 모두 동일한 `DateInfo[]`이며, `public`은 `date` → `kind` 순 정렬입니다.

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

## 병합 규칙 (`public = build(auto, manual)`)

`date + kind` 그룹 단위로 병합하며 **manual이 우선**합니다.

- `manual`에 해당 `date+kind` 그룹이 있으면 → `auto`의 그 그룹을 버리고 **manual로 통째 대체**.
- 없으면 → `auto` 그대로.
- **수동 편집이 항상 우선**이므로 자동 조회가 수동 값을 덮지 않습니다.
- 삭제(auto 단독 항목 완전 제거)는 현재 지원하지 않습니다.
- **알려진 한계**: 원본 API가 기존 `date+kind`의 항목명을 바꾸면, 옛 이름의 항목이 `auto/`에 남아 `public/`에는 같은 그룹의 중복으로 나타납니다. 해당 `date+kind` 그룹에 `manual/` 오버라이드를 추가(그룹 전체 대체)하면 해소됩니다.

수동 편집법은 [`manual/README.md`](./manual/README.md) 참고. 편집 후 `npm run build`로 `public/`을 재생성하세요.

## 로컬 개발

Node.js 22 이상이 필요합니다. 외부 npm 의존성은 없습니다.

```bash
# 1) API 키 준비 — 공공데이터포털 Decoding 키(날것)를 넣습니다. Encoding 키는 넣지 마세요.
cp .env.example .env && $EDITOR .env   # DATA_GO_KR_KEY=...

# 2) 특일정보 조회 → auto/ 갱신 (기본: 이번 달~다다음 달, 3개월 롤링)
node --env-file=.env scripts/fetch.mjs
# 특정 연/월만: FETCH_YEAR=2027 FETCH_MONTH=1 node --env-file=.env scripts/fetch.mjs

# 3) public/ 생성 (auto + manual 병합)
npm run build

# 4) 검증 / 테스트
npm run validate
npm test
```

> **API 키 주의**: 공공데이터포털은 Encoding 키와 Decoding 키를 함께 발급합니다.
> 이 프로젝트는 **Decoding 키(날것)** 를 저장하고 코드가 1회만 URL 인코딩합니다.
> Encoding 키를 넣으면 이중 인코딩으로 `401`이 발생합니다.

## 자동화 (GitHub Actions)

- **공휴일 자동 갱신** (`.github/workflows/update.yml`): 매일 KST 09시 → 조회 → build → 변경 시 PR 생성.
- **공휴일 수동 백필** (`.github/workflows/backfill.yml`): Actions 탭에서 연/월을 지정해 수동 실행 → PR 생성.
- **GitHub Pages 배포** (`.github/workflows/deploy-pages.yml`): `main`의 `public/**`가 바뀌면 `public/`을 Pages로 배포. 데이터 PR이 머지될 때마다 자동 갱신됩니다.

갱신·백필 워크플로우는 `main`에 직접 커밋하지 않고 **PR로만** 올립니다. `auto/`와 그 결과인 `public/` diff를 확인한 뒤 머지하세요.

### 설정

1. **Secret 등록** — 저장소 **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `DATA_GO_KR_KEY`
   - Value: 공공데이터포털 **Decoding 키**
2. **PR 생성 권한 허용** — **Settings → Actions → General → Workflow permissions**
   - "Allow GitHub Actions to create and approve pull requests" 체크
3. **GitHub Pages 활성화** — **Settings → Pages → Build and deployment → Source**
   - "GitHub Actions" 선택 (최초 1회). 이후 `deploy-pages.yml`이 자동 배포합니다.

## 데이터 출처

공공데이터포털 [한국천문연구원_특일 정보](https://www.data.go.kr/data/15012690/openapi.do).

## 기여

이슈와 PR을 환영합니다. 데이터 오류 제보 시 해당 `날짜 / 이름 / 연도 파일`을 함께 적어 주세요.
PR 전에 `npm run build` 후 `npm run validate`와 `npm test`가 통과하는지 확인해 주세요.

## 라이선스

[MIT](./LICENSE) — 코드 및 이 저장소의 구성물.
원본 특일 데이터의 이용 조건은 공공데이터포털의 이용허락범위를 따릅니다.
