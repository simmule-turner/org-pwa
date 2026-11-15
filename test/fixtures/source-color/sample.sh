#!/bin/bash
# build script
set -eu
NAME="world"
count=0
export PATH="$HOME/bin:$PATH"
greet() {
  local who=$1
  echo "Hello, ${who}! $(date +%Y) `uname`"
}
function cleanup {
  rm -rf /tmp/x
}
for f in *.txt; do
  if [ -f "$f" ] && [[ $f == a* ]]; then
    cat "$f" | grep -v 'skip' >> out.log
  elif test -d "$f"; then
    echo 'single $quoted'
  else
    continue
  fi
done
while read -r line; do
  case "$line" in
    start) echo go ;;
    *) echo "$line" ;;
  esac
done < input.txt
cat <<EOT
heredoc $NAME
EOT
x=$((count + 1))
echo $x $? $# ${arr[@]} "$@"
ls -la --color=auto | sort -k2 &
trap cleanup EXIT
