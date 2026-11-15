#!/bin/sh
A=1; B[2]=3
echo $(date) `date`
cat <<EOF # trailing comment
body
EOF
case "$x" in
  start|stop) echo s ;; # c
  *) esac
esac
echo $((a<<2)) a<<EOF2
EOF2
echo "x $(cat <<E
in
E
)"
if true
then
  ! echo x
fi
echo foo\
bar \
  baz
x=1 # c1
#!notshebang
echo a#b ;#c
echo ( #not
f() { :; } # c
