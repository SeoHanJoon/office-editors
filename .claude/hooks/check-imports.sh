#!/usr/bin/env bash
# 파일을 고친 직후 패키지 의존 방향(.claude/rules/project.md)을 검사한다.
# 위반이면 exit 2로 Claude에게 알려서 바로 고치게 한다.
# 코드 파일을 고쳤으면 Stop 훅이 typecheck/test를 돌리도록 표시도 남긴다.

input=$(cat)
file=$(jq -r '.tool_input.file_path // empty' <<<"$input")
[[ -z "$file" || ! -f "$file" ]] && exit 0

rel=${file#"$CLAUDE_PROJECT_DIR"/}

case "$rel" in
  *.ts | *.tsx | *.js | *.jsx | *.mts | *.cts) ;;
  *) exit 0 ;;
esac

mkdir -p "$CLAUDE_PROJECT_DIR/.claude/.cache"
touch "$CLAUDE_PROJECT_DIR/.claude/.cache/needs-verify"

# 테스트 파일은 HyperFormula 등 테스트 전용 의존이 허용되므로 검사하지 않는다.
case "$rel" in
  *.test.* | *.spec.* | */e2e/*) exit 0 ;;
esac

[[ "$rel" =~ ^packages/([^/]+)/ ]] || exit 0
pkg=${BASH_REMATCH[1]}

# import/export ... from 'x', import('x'), require('x')에서 모듈 이름만 뽑는다.
modules=$(grep -oE "(from|import|require)[[:space:]]*\(?[[:space:]]*['\"][^'\"]+['\"]" "$file" \
  | sed -E "s/.*['\"]([^'\"]+)['\"]/\1/" | sort -u)

errors=()
for m in $modules; do
  # 상대 경로는 패키지 밖으로 나가는 경우만 본다.
  if [[ "$m" == .* ]]; then
    # 폴더가 아직 없어도 되도록 문자열로 경로를 정리한다. (a/b/../c → a/c)
    parts=()
    IFS=/ read -ra segs <<<"$(dirname "$rel")/$m"
    for s in "${segs[@]}"; do
      case "$s" in
        "" | .) ;;
        ..) ((${#parts[@]})) && unset 'parts[${#parts[@]}-1]' ;;
        *) parts+=("$s") ;;
      esac
    done
    trel=$(IFS=/; echo "${parts[*]}")
    [[ "$trel" =~ ^packages/([^/]+) ]] || continue
    dep=${BASH_REMATCH[1]}
    [[ "$dep" == "$pkg" ]] && continue
    m="packages/$dep"
  fi

  name=${m##*/}              # @scope/excel → excel
  base=${m%%/*}              # react/jsx-runtime → react
  [[ "$m" == @*/* ]] && name=$(cut -d/ -f2 <<<"$m") && base="$m"

  case "$pkg" in
    command-core)
      errors+=("command-core는 아무것도 import하지 않는다: '$m'") ;;
    ui)
      [[ "$base" == react || "$base" == react-dom || "$base" == react/* ]] && continue
      errors+=("ui는 React만 import할 수 있다: '$m'") ;;
    excel | docs | ppt)
      if [[ "$name" =~ ^(excel|docs|ppt)$ && "$name" != "$pkg" ]]; then
        errors+=("${pkg}는 ${name}을 import할 수 없다. 공통 코드는 command-core나 ui로 옮긴다: '$m'")
      elif [[ "$pkg" == excel && "$m" == hyperformula* ]]; then
        errors+=("HyperFormula는 테스트에서만 쓴다: '$m'")
      fi ;;
  esac
done

if ((${#errors[@]})); then
  {
    echo "패키지 의존 방향 위반 ($rel):"
    printf '  - %s\n' "${errors[@]}"
    echo "규칙: .claude/rules/project.md \"패키지 의존 방향\". 새 의존이 꼭 필요하면 사용자에게 먼저 물어본다."
  } >&2
  exit 2
fi
exit 0
