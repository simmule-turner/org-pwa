package org.orgpwa.app;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Receives text shared to the app from other apps (Android's Share sheet, ACTION_SEND) and hands it to the web app as a
 * "shareReceived" event with { title, text }. Capacitor delivers the launch intent here too (BridgeActivity.onCreate ends
 * by calling onNewIntent), so one hook covers a share that starts the app and one that arrives while it is running. The
 * event is retained until the page has registered a listener, so a share that starts the app is not lost while the page
 * is still loading. native-platform.js does the registering; the web app decides what to do with the share.
 */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {

    // Marks an intent as delivered: the same intent comes round again if the activity is recreated.
    private static final String DELIVERED = "org.orgpwa.app.SHARE_DELIVERED";

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String type = intent.getType();
        if (type == null || !type.startsWith("text/")) return;
        if (intent.getBooleanExtra(DELIVERED, false)) return;
        intent.putExtra(DELIVERED, true);

        // EXTRA_TEXT and EXTRA_TITLE may be any CharSequence (a styled string, say), which getStringExtra would drop.
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        CharSequence title = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
        if (title == null) title = intent.getCharSequenceExtra(Intent.EXTRA_TITLE);

        JSObject share = new JSObject();
        if (text != null) share.put("text", text.toString());
        if (title != null) share.put("title", title.toString());
        if (!share.has("text") && !share.has("title")) return;
        notifyListeners("shareReceived", share, true);
    }
}
