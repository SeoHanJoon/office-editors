#!/usr/bin/env bash
# gh pr create / gh pr edit을 실행하기 전에 PR 본문에 상대 링크가 있는지 검사한다.
# PR 본문의 상대 링크(](adr/...))는 PR 페이지 기준으로 해석돼 404가 나므로 exit 2로 막는다.
# 본문은 명령 안(--body, heredoc)이나 --body-file 파일에서 찾는다.

input=$(cat)
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
grep -qE 'gh[[:space:]]+pr[[:space:]]+(create|edit)' <<<"$cmd" || exit 0

body=$cmd
file=$(grep -oE -- "--body-file[= ]+[\"']?[^\"' ]+" <<<"$cmd" | head -1 | sed -E "s/--body-file[= ]+[\"']?//")
if [[ -n "$file" && "$file" != "-" ]]; then
  cwd=$(jq -r '.cwd // empty' <<<"$input")
  [[ "$file" != /* && -n "$cwd" ]] && file="$cwd/$file"
  [[ -f "$file" ]] && body+=$'\n'"$(cat "$file")"
fi

# ](...) 안이 http(s)://, #, mailto:로 시작하지 않으면 상대 링크다.
links=$(grep -oE '\]\([^)[:space:]]+\)' <<<"$body" | grep -vE '^\]\((https?://|#|mailto:)' | sort -u)
[[ -z "$links" ]] && exit 0

{
  echo "PR 본문에 상대 링크가 있다. PR 페이지 기준으로 해석돼 404가 난다:"
  sed 's/^/  - /' <<<"$links"
  echo "커밋 SHA로 고정한 전체 주소로 바꾼다: \$(gh repo view --json url -q .url)/blob/\$(git rev-parse HEAD)/<경로>"
} >&2
exit 2
