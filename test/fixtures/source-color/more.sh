# no shebang; sh-style words
FOO=1 BAR+=2 arr[3]=x cmd
echo "${a:-"x y"}" ${#} $$ $* $_ ${@}
echo a; echo b && echo c || echo d | tee x
(cd /tmp; ls) { echo hi; }
if [ $a = 1 ]; then echo "yes"; elif [ x ]; then echo no; else echo e; fi
while :; do read x; done
for ((i=0;i<3;i++)); do echo $i; done
cat <<EOF1 <<EOF2
one
EOF1
two
EOF2
echo done
echo `echo \`inner\`` ok
echo 'a\'b' c
echo "a\\" 'x'
x=$(cat <<EOT
inside $(date)
EOT
)
echo $(( x << 1 )) <<< "here string"
a=b c=d; echo ${a}${c}
echo "$(( 3 + 4 ))" '$(not)' $(not exec)
function f() { local -r z=1; }
foo-bar() { :; }
ls -l | while read -r l; do echo "$l"; done
echo é "ünï" $é
cat << EOF
spaced
 EOF
last
