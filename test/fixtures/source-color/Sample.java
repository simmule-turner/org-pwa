package com.example;

import java.util.List;

/** Javadoc comment. */
@Deprecated
public class Sample<T extends Comparable<T>> implements Runnable {
    // line comment
    /* block comment */
    private static final int MAX = 0xFF + 10L + 1_000;
    private final String name = "text \"q\" \n";
    char c = 'x';
    boolean ok = true, no = false;
    Object o = null;

    public Sample(String name) { this.name = name; }

    @Override
    public void run() {
        List<String> xs = new ArrayList<>();
        for (int i = 0; i < 10; i++) { if (i == 3) continue; else break; }
        try { throw new IllegalStateException("x"); }
        catch (RuntimeException e) { System.out.println(e); }
        finally { return; }
    }

    static <U> U id(U u) { return u; }
    enum Color { RED, GREEN }
    interface Thing { void go(); }
    abstract synchronized void m() throws Exception;
    double d = 3.14e2f;
    var v = (String) o instanceof String;
}
