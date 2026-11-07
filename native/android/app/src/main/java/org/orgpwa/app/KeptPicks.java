package org.orgpwa.app;

import java.util.HashSet;
import java.util.Set;

/**
 * The addresses (URIs) of the files the person picked with org-attach-method mv or ln in this run of the app, and nothing else.
 * AttachmentsPlugin deletes a picked original (mv) or keeps a link to one (ln) only for an address in this list, so a call
 * with any other address, whatever access the app happens to hold to it, is refused.
 */
final class KeptPicks {

    private static final Set<String> URIS = new HashSet<>();

    private KeptPicks() {}

    static synchronized void add(String uri) {
        if (uri != null && !uri.isEmpty()) URIS.add(uri);
    }

    static synchronized boolean contains(String uri) {
        return uri != null && URIS.contains(uri);
    }

    static synchronized void remove(String uri) {
        if (uri != null) URIS.remove(uri);
    }
}
