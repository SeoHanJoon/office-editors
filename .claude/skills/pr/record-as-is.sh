#!/usr/bin/env bash
# PR의 브라우저 테스트를 base 브랜치 코드 위에서 녹화해 recordings/as-is/에 둔다. (ADR 0006)
# 사용: record-as-is.sh [base 브랜치, 기본 main]
# `pnpm e2e:record`(to-be)를 먼저 돌린 뒤에 실행한다. e2e:record는 시작할 때 recordings/를 비우기 때문이다.
# 종료 코드: 0 녹화함 / 3 base에 브라우저 테스트 설정이 없어 as-is를 만들 수 없음

set -euo pipefail
base=${1:-main}
root=$(git rev-parse --show-toplevel)

git -C "$root" fetch -q origin "$base"
tmp=$(mktemp -d)
wt="$tmp/as-is"
cleanup() {
  local status=$?
  git -C "$root" worktree remove --force "$wt" >/dev/null 2>&1 || true
  rm -rf "$tmp"
  exit "$status"
}
trap cleanup EXIT
git -C "$root" worktree add -q --detach "$wt" "origin/$base"

if [[ ! -f "$wt/apps/web/playwright.config.ts" ]]; then
  echo "as-is 없음: ${base}에 apps/web 브라우저 테스트 설정이 없다." >&2
  exit 3
fi

# 같은 시나리오를 비교하려고 PR의 테스트 파일을 base 코드 위에서 돌린다.
rm -rf "$wt/apps/web/e2e"
cp -R "$root/apps/web/e2e" "$wt/apps/web/e2e"

cd "$wt"
pnpm install --frozen-lockfile --prefer-offline >/dev/null
pnpm --filter @office/web exec playwright install chromium >/dev/null

# CI=1: 이미 떠 있는 서버(to-be일 수 있음)를 재사용하지 않고 base 코드로 새로 띄운다.
# as-is에서는 바뀐 동작 때문에 테스트가 실패할 수 있다. 실패해도 영상은 남으므로 계속 진행한다.
if ! E2E_PORT=3100 CI=1 pnpm e2e:record --retries=0; then
  echo "as-is 테스트 일부 실패 (PR에서 동작을 바꿨다면 정상)" >&2
fi

mkdir -p "$root/recordings/as-is"
cp -R "$wt/recordings/." "$root/recordings/as-is/"
find "$root/recordings/as-is" -name '*.webm' | sort
