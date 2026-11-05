#!/usr/bin/env bash
# 공개 저장소 만들기 + 푸시 + GitHub Pages(정적 빌드) 배포 — 저장소 루트에서 Git Bash 로 실행
#   bash tools/publish-github.sh
# 앞서 gh auth login 이 되어 있어야 한다. 공개하면 public/kjl(쿠지알러 원본에서 뽑은 장 모델 · 카탈로그)도 누구나 받을 수 있다.
set -euo pipefail
REPO=leecreizer/kitchen-planner

# 1) 저장소(공개) — 이미 있으면 건너뛴다
gh repo view "$REPO" >/dev/null 2>&1 || gh repo create "$REPO" --public --description "부엌 셀프 설계 — 쿠지알러 부엌 원본 · 자동 배치 · 실사 렌더"

# 2) 소스 푸시
git push -u origin main

# 3) 정적 빌드 → gh-pages 브랜치(빌드 결과만 담은 별도 이력)
npx vite build
rm -rf .pages && cp -r dist .pages && touch .pages/.nojekyll
(
  cd .pages
  git init -q -b gh-pages
  git add -A
  git commit -q -m "Pages: $(git -C .. rev-parse --short HEAD) 빌드"
  git push -f "https://github.com/$REPO.git" gh-pages
)
rm -rf .pages

# 4) Pages 켜기(gh-pages 브랜치 루트) — 이미 켜져 있으면 갱신
gh api -X POST "repos/$REPO/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null 2>&1 \
  || gh api -X PUT "repos/$REPO/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null
echo "접속 주소: https://leecreizer.github.io/kitchen-planner/  (첫 배포는 1~2분 뒤 열림)"
