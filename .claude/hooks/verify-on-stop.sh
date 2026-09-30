#!/usr/bin/env bash
# Claude가 답변을 끝내려 할 때, 이번에 코드를 고쳤다면 typecheck와 test를 돌린다.
# 실패하면 exit 2로 끝내지 못하게 하고 결과를 Claude에게 넘긴다.

input=$(cat)
cd "$CLAUDE_PROJECT_DIR" || exit 0

marker=.claude/.cache/needs-verify

# 이미 한 번 막혀서 다시 멈추는 중이면 무한 반복을 막기 위해 통과시킨다.
[[ "$(jq -r '.stop_hook_active // false' <<<"$input")" == true ]] && exit 0
[[ -f "$marker" ]] || exit 0
[[ -f package.json ]] || exit 0 # Step 0 전에는 실행할 스크립트가 없다.

for script in typecheck test; do
  if ! out=$(pnpm -s "$script" 2>&1); then
    {
      echo "pnpm $script 실패. 결과를 사용자에게 그대로 보고하고 원인을 고친다."
      echo "----- 마지막 60줄 -----"
      tail -n 60 <<<"$out"
    } >&2
    exit 2
  fi
done

rm -f "$marker"
exit 0
