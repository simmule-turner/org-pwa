#!/usr/bin/env bash
# edge cases: comments, quotes, heredocs
echo foo#bar # real comment
echo \# not a comment ${#arr[@]} $# "a#b" 'c # d'
echo "$(echo "nested \"q\" $(date))" tail
x=`echo "a b"` y="$(cmd 'it''s' "z")"
cat <<-'END' | grep x
	indented $HOME `no`
	END
cat <<"E2" >f; echo after
raw "text
E2
echo $((1 << 2)) ${v:-default} ${v%%.*} $[1+2]
arr=(one two "three four")
arr+=(five)
declare -A map; map[k]=v
[[ ! -n $x ]] && ! false
if ! [ -z "$x" ]; then :; fi
case $1 in
  a|b) echo ab ;;
  (c) echo c ;;
  *) ;;
esac
foo() { echo "$1"; }
function bar() { return 0; }
function baz { :; }
echo a \
  b \\
  c
trap 'echo bye' INT
time ls
until false; do break; done
select x in a b; do echo $x; done
export -f foo
. ./lib.sh
source ./lib2.sh
echo "unterminated
