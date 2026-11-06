# 부엌 셀프 설계 (kitchen-planner)

부엌 셀프 설계 웹. 부엌장은 쿠지알러 부엌 파라메트릭 원본(editorData)을 계산해 그리고, 배치는 규칙 + 점수 탐색으로 자동으로 놓는다.

```
npm run dev        # http://127.0.0.1:5220 (AI 중계 /api/ai 포함)
npm run check      # 타입 검사 + 회귀 점검 6가지(장 계산 오류 · 상부장 끝 · 창 위 빈틈 · 아일랜드 붙임 ×2 · 공도어)
npm run build      # dist (정적 배포 — AI 중계는 없어서 프롬프트는 규칙 해석)
npm run data       # public/kjl 다시 만들기 (KJL_SRC = 쿠지알러 원본 폴더, PLANNER_PUBLIC = 바닥 · 벽지 재질 폴더)
npm run glb        # public/props 의 GLB 를 Draco + WebP 로 압축(이미 압축된 것은 건너뜀, GLTF_NODE_MODULES = gltf-transform · sharp 가 깔린 node_modules)
npm run profiles   # 단면(프로파일) 자료 · 도어별 빠진 단면 점검 (KJL_SRC 필요)
```

## 기능

- **자동 배치** — 공간 구조(ㅡ · ㄱ · ㄷ · 11자 · 벽마다) · 스타일 · 바라는 것으로 원본 모듈 폭을 채우고 점수순 4안. 아일랜드를 장 줄에 대면 코너장으로 ㄱ · T자 연결
- **직접 고치기** — 장 끌기 · 순서 바꾸기 · 폭 · 교체 · 추가 · 빼기, 공간 요소(창 · 다용도실 · 서브주방 · 팬트리), 벽 길이 · 거실 크기
- **설계 파일** — 저장(Ctrl+S) · 불러오기(Ctrl+O). 설계와 지금 배치안(직접 고친 장까지)을 한 파일(`*.kitchen.json`)로. 견적 데이터 · 그때의 조명 · 후처리도 참고로 실린다
- **되돌리기 · 다시 하기** — Ctrl+Z · Ctrl+Y, 각 50단계. 새로고침해도 고친 장이 남는다(브라우저 자동 저장)
- **견적 데이터** — 부품 목록 CSV(장 원본 ID · 원본 이름 · 원본 파일 · 실제 규격 · 도어 · 상판 · 벽 마감 · 걸레받이 · 몰딩 · 가전 · 식탁). 한샘 품목 코드 · 장 단가는 원본에 없어 빈 칸
- **프롬프트** — 규칙 해석 또는 AI(Claude · Gemini · GPT 골라서). AI 는 설계 값만 고르고 배치는 자동 배치가 한다
- **평면도 동선 정보** — 작업 삼각형 변 길이 · 통로 폭(치수선) · 이동 경로(거실 → 냉장고 → 싱크 → 쿡탑)
- **3D** — WebGPU 실시간(SSGI · GTAO · TRAA · 블룸 · 공간 라이트맵), 실사 모드(MuTracer · 굽기 · 서펠 · 경로 추적)

## AI 키 (프롬프트 AI 해석)

`.env.local.example` 을 `.env.local` 로 복사해 키를 넣고 `npm run dev` 를 다시 켠다. 키는 개발 서버에만 있고 브라우저로 가지 않는다(`.env.local` 은 git 에 안 올라간다).
`ANTHROPIC_API_KEY` · `GEMINI_API_KEY`(또는 `GOOGLE_API_KEY`) · `OPENAI_API_KEY` — 없는 곳은 프롬프트 줄에서 「키 없음」으로 꺼진다.

## 구성

| 파일 | 하는 일 |
|---|---|
| `tools/build_kitchen_data.py` | 원본 editordata 에서 장 모듈 74종 × 계열(유로 EO · 키친바흐 KB) · 그레이드별 도어 · 하위 모델 · 재질 텍스처를 `public/kjl` 로 |
| `tools/build_profiles.py` · `tools/probe-profiles.ts` | 단면(프로파일) 자료(`public/kjl/profiles.json`) — 받아 둔 단면 좌표 · 이름 · 도어마다 실제로 빠진 단면 |
| `tools/compress_glb.mjs` | GLB 압축 — 정점 용접 · 중복 정리 · 텍스처 WebP(1024) · Draco |
| `tools/check.mjs` · `tools/probe-*.ts` | 회귀 점검 · 규칙별 조사(지난 일회성 시험은 `tools/archive`) |
| `server/aiProxy.ts` | AI 중계(개발 서버 · 미리보기 전용) — Claude · Gemini · GPT |
| `src/kjl/*` | 파라메트릭 모델 계산기 (resolve · geometry · doc · expr …) |
| `src/kjlLib.ts` | 카탈로그 · 모델 받기(하위 모델까지 미리) · 상품 · 단면 조회 |
| `src/plan.ts` · `src/autoplan.ts` · `src/reorder.ts` | 설계 데이터 · 자동 배치(점수: 작업 삼각형 · 조리 공간 · 수납 · 채광 · 동선) · 장 끼우기 · 미세 이동 |
| `src/cabinet3d.ts` · `src/kitchen3d.ts` · `src/room3d.ts` · `src/dining3d.ts` | 원본 계산 결과 → three.js · 걸레받이 · 상판 · 타일 · 기기 · 방 · 식탁 |
| `src/scene.ts` · `src/render/*` | 3D 화면(필요할 때만 그리기 · 카메라 쪽 벽 숨김 · 끌기) · 실시간 후처리 · 실사 엔진 |
| `src/plan2d.ts` · `src/flow.ts` | 평면도 · 동선 정보 |
| `src/project.ts` · `src/bom.ts` · `src/ai.ts` | 설계 파일 · 되돌리기 · 견적 데이터 · 프롬프트 AI 해석 |
| `src/dispose.ts` | 다 쓴 3D 묶음 해제(캐시가 같이 쓰는 형상 · 재질 · 텍스처는 건너뜀) |

## 도어 그레이드

원본 제품 패키지 분류 그대로: 유로 300 · 500 · 700 · 900 (유로 몸통, 변수 `EM_DR`) · 키친바흐 KB5 · KB7 (키친바흐 몸통, 변수 `KB_DR`). 단종 · 테스트 · Custom 은 뺐다.

**단면 자료** — 액자 도어 테두리 · 찬넬 · 몰딩은 쿠지알러 단면(유형 14)을 스윕해 만든다. 단면 좌표는 받아 둔 원본에 없어 계산기가 18×18 네모로 대신 그린다.
앞판 자체를 단면으로 만드는 도어(키친바흐 KB5 MHT 24종 · 유로 900 아티잔 2종)는 앞판이 깨져 보여 목록에서 막아 두었다. 단면 좌표를
`$KJL_SRC/profiles/<id>.json`(`{"name", "w", "h", "points": [[x, y], …]}`, mm)로 받아 `npm run profiles` 를 돌리면 풀린다(필요한 단면 29종은 `public/kjl/profiles.json` 의 `info`).

## 원본에 없어 따로 만든 것

3D 메시 하위 모델(다릿발 · 싱크볼 · 수전 · 쿡탑 · 식기세척기 · 후드 기기)은 원본 메시가 없다 → 걸레받이 · 형상 · 도어 재질 패널 · 홈뷰 상품 GLB(압축본)로 대신. 상판은 쿠지알러 설계 도구가 만드는 것이라 같은 재질 라이브러리(HS스톤 등)로 직접 만든다. 냉장고 · 식세기 속 · 로봇청소기는 코드로 만든 형상이다.

## 자원

- 창밖 · 하늘 HDR 은 1K(2K 와 같은 시점 비교에서 차이가 잡음 수준) — `public/env`
- 상품 GLB(싱크볼 · 수전 · 쿡탑 · 식탁 · 의자 72개)는 Draco + WebP 압축(104.7 → 9.7MB), 해독기 `public/draco`
