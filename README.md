# holidays

한국 공휴일·기념일·24절기·잡절 데이터를 연도별 JSON으로 관리하고 CDN으로 배포합니다.
데이터 출처: 공공데이터포털 "한국천문연구원_특일 정보".

## 사용 (CDN)

```
https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/{year}.json
https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/index.json
```

예: `https://cdn.jsdelivr.net/gh/jjh2613/holidays@main/public/2026.json`

> `@main`은 캐시가 최대 12~24h입니다. 즉시 반영이 필요하면 git 태그를 찍고 `@v1.0.0`처럼 버전을 지정하세요.

## 데이터 스키마

```ts
interface DateInfo {
  date: string;        // "YYYY-MM-DD"
  name: string;
  holiday: boolean;    // 법정공휴일 여부
  remarks: string | null;
  kind: 1 | 2 | 3 | 4; // 1=공휴일 2=기념일 3=절기 4=잡절
  time: string | null; // 절기만 "HH:mm"
  sunLng: number | null;
}
```

`index.json`: `{ "years": number[], "updatedAt": string }`

## 로컬 개발

```bash
# 1) API 키 준비 — Decoding 키(날것)를 넣습니다. Encoding 키 금지.
cp .env.example .env && vi .env   # DATA_GO_KR_KEY=...

# 2) 초기 데이터 시드 (원본에서 2004~2026 복사)
npm run seed

# 3) 특일정보 조회 (기본: 이번 달~다다음 달)
node --env-file=.env scripts/fetch.mjs
# 특정 연/월: FETCH_YEAR=2027 FETCH_MONTH=1 node --env-file=.env scripts/fetch.mjs

# 4) 검증 / 테스트
npm run validate
npm test
```

## 자동화 (GitHub Actions)

- **공휴일 자동 갱신** (`update.yml`): 매일 KST 09시 → 이번 달~다다음 달 조회 → 변경 시 PR 생성.
- **공휴일 수동 백필** (`backfill.yml`): Actions 탭에서 연/월 지정해 수동 실행 → PR 생성.
- 두 워크플로우 모두 `main`에 직접 커밋하지 않고 **PR로만** 올립니다. diff 확인 후 머지하세요.

### 설정
저장소 **Settings → Secrets and variables → Actions → New repository secret**:
- Name: `DATA_GO_KR_KEY`
- Value: 공공데이터포털 **Decoding 키**

## 병합 규칙
자동 조회는 `date|kind|name` 키 기준으로 병합합니다. 로컬에 없는 API 항목은 새로 추가되고,
이미 로컬에 있는 항목은 그대로 유지됩니다 (수동으로 수정한 값은 자동 조회로 덮어써지지 않습니다).
(API의 항목 삭제는 자동 반영되지 않으므로 필요 시 수동 삭제)
