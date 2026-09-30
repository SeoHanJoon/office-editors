#!/usr/bin/env bash
# 세션 시작 시 현재 브랜치와 Step 진행 상황을 Claude에게 알려준다. (stdout이 대화 맥락에 들어감)
cd "$CLAUDE_PROJECT_DIR" || exit 0

branch=$(git branch --show-current 2>/dev/null)
echo "현재 브랜치: ${branch:-알 수 없음}"

if [[ "$branch" =~ ^step-([0-9]+) ]]; then
  echo "현재 Step: ${BASH_REMATCH[1]} (README \"3. Step 목록\"의 범위 안에서만 작업)"
fi

echo "Step 진행 상황 (README):"
grep -E '^\| \*\*[0-9]+\*\*' README.md | awk -F'|' '{ gsub(/^ +| +$|\*/, "", $2); gsub(/^ +| +$/, "", $4); print "  Step " $2 " — " $4 }'
exit 0
