# manual/

사람이 관리하는 오버라이드 레이어입니다. `public/`은 `auto/`(API 자동 조회) + 이 디렉터리를 병합한 결과입니다.

## 형식

`manual/{year}.json` — `DateInfo[]` 배열 (auto와 동일 스키마).

```json
[
  {
    "date": "2026-06-03",
    "name": "임시공휴일",
    "holiday": true,
    "remarks": null,
    "kind": 1,
    "time": null,
    "sunLng": null
  }
]
```

## 병합 규칙 (`npm run build`)

- 병합 단위: `date + kind` 그룹.
- 이 파일에 어떤 `date+kind` 그룹이 있으면 → `auto`의 그 그룹은 버리고 이 파일 항목으로 **통째 대체**됩니다.
- 없으면 → `auto` 그대로 사용됩니다.
- **주의**: 같은 날 같은 kind가 여러 건인 경우(예: 어린이날+석가탄신일, 둘 다 kind 1),
  그 그룹을 손대려면 유지할 항목을 **모두** 적어야 합니다. 하나만 적으면 나머지는 사라집니다.
- 편집 후 `npm run build`로 `public/`을 재생성하세요. `npm run validate`가 최신 여부를 검사합니다.
