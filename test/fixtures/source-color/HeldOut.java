package com.example.app;

import java.util.List;
import java.util.Map;

/** A thing. */
@SuppressWarnings("unchecked")
public final class Thing<T extends Comparable<T>> extends Base implements Runnable, Serializable {
    private static final int MAX = 0xFF + 10L;
    private final Map<String, List<T>> items = new HashMap<>();
    protected volatile boolean done;

    public Thing(int n) { super(n); this.done = false; }

    @Override
    public synchronized void run() throws InterruptedException {
        for (int i = 0; i < MAX; i++) {
            if (items.isEmpty() || i % 2 == 0) { continue; }
            try {
                String s = (String) lookup("k" + i);
                var x = s.length() > 3 ? s : null;
            } catch (IllegalStateException | NullPointerException e) {
                throw new RuntimeException("bad", e);
            } finally { done = true; }
        }
        switch (MAX) { case 1: break; default: return; }
    }

    static <U> U first(List<? extends U> xs) { return xs.get(0); }
    enum Color { RED, GREEN }
    interface Shape { double area(); }
    // trailing
    char c = 'x'; double d = 1.5e3; Object o = null; boolean b = this instanceof Thing;
}
