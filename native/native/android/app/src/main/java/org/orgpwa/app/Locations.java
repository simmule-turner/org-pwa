package org.orgpwa.app;

import android.content.Intent;
import android.os.Build;
import android.provider.DocumentsContract;

/**
 * Where things go by default. Documents the person opens or creates start in the app's own folder in the shared Documents
 * folder, Documents/org-pwa, and what the app exports goes to Downloads. Android's file pickers can still go anywhere the
 * person points them; this only chooses where they START. It is a hint: a picker that cannot honour it (the folder does not
 * exist yet, or an old Android) starts where it last was, which is harmless.
 */
final class Locations {

    static final String ORG_PWA_FOLDER = "Documents/org-pwa";
    private static final String EXTERNAL_STORAGE = "com.android.externalstorage.documents";

    private Locations() {}

    /** Makes a file or folder picker start in Documents/org-pwa. */
    static void startInOrgPwaFolder(Intent picker) {
        startIn(picker, "primary:" + ORG_PWA_FOLDER);
    }

    /** Makes a "save as" picker start in Downloads. */
    static void startInDownloads(Intent picker) {
        startIn(picker, "primary:Download");
    }

    private static void startIn(Intent picker, String documentId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            picker.putExtra(DocumentsContract.EXTRA_INITIAL_URI, DocumentsContract.buildDocumentUri(EXTERNAL_STORAGE, documentId));
        }
    }
}
