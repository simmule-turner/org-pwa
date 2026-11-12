package com.Example;
class Pairs {
    Pairs(int a, int b) { }
    Pairs(List<String> names, String s) { }
    Pairs(final String s) { }
    boolean test(int i, int n) {
        boolean x = i < n;
        boolean y = i<MAX && n <= MAX;
        boolean z = i < Foo.BAR || i << 2 > 0 || foo() < MAX;
        return x;
    }
}
