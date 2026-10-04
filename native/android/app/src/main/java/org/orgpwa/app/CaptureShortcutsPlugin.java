package org.orgpwa.app;

import android.content.Context;
import android.content.Intent;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Capture templates as launcher shortcuts: the list that appears when the app icon is long-pressed, and icons for them on
 * the home screen. The web app publishes one dynamic shortcut per template with setShortcuts. Tapping one starts (or returns to)
 * the app with a CAPTURE intent, which arrives in handleOnNewIntent, the same hook a cold start uses, and is raised as a
 * "captureRequested" event with the template's key ('' for the template list). The event is retained until the page has a
 * listener, so a shortcut that starts the app is not lost while the page loads. native-platform.js connects both ends.
 */
@CapacitorPlugin(name = "CaptureShortcuts")
public class CaptureShortcutsPlugin extends Plugin {

    static final String ACTION_CAPTURE = "org.orgpwa.app.CAPTURE";
    private static final String EXTRA_KEY = "org.orgpwa.app.CAPTURE_KEY";
    // Marks an intent as delivered: the same intent comes round again if the activity is recreated.
    private static final String DELIVERED = "org.orgpwa.app.CAPTURE_DELIVERED";
    private static final String ID_PREFIX = "capture:";

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null || !ACTION_CAPTURE.equals(intent.getAction())) return;
        if (intent.getBooleanExtra(DELIVERED, false)) return;
        intent.putExtra(DELIVERED, true);
        String key = intent.getStringExtra(EXTRA_KEY);
        JSObject event = new JSObject();
        event.put("key", key == null ? "" : key);
        notifyListeners("captureRequested", event, true);
    }

    /** Publishes the shortcuts: `shortcuts` is a list of { key, label }, in the order they should appear. */
    @PluginMethod
    public void setShortcuts(PluginCall call) {
        JSArray requested = call.getArray("shortcuts");
        if (requested == null) {
            call.reject("shortcuts is required");
            return;
        }
        Context context = getContext();
        // A launcher shows only a few, and publishing more than it allows throws: the templates fill every place, in their order.
        int max = ShortcutManagerCompat.getMaxShortcutCountPerActivity(context);
        int room = Math.max(0, max);
        List<ShortcutInfoCompat> shortcuts = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        try {
            for (int i = 0; i < requested.length() && shortcuts.size() < room; i++) {
                JSONObject item = requested.getJSONObject(i);
                String key = item.optString("key", "");
                if (key.isEmpty() || !seen.add(key)) continue;
                shortcuts.add(build(context, key, item.optString("label", ""), shortcuts.size()));
            }
        } catch (JSONException e) {
            call.reject("shortcuts must be a list of { key, label }");
            return;
        }
        try {
            ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts);
        } catch (IllegalArgumentException e) {
            call.reject("The launcher refused the shortcuts: " + e.getMessage());
            return;
        }
        JSObject result = new JSObject();
        result.put("sent", shortcuts.size());
        result.put("max", max);
        result.put("published", ShortcutManagerCompat.getDynamicShortcuts(context).size());
        call.resolve(result);
    }

    /** What the launcher reports, for diagnosing: its limit, the ids of the dynamic shortcuts published, and pinning. */
    @PluginMethod
    public void info(PluginCall call) {
        Context context = getContext();
        JSArray ids = new JSArray();
        for (ShortcutInfoCompat shortcut : ShortcutManagerCompat.getDynamicShortcuts(context)) ids.put(shortcut.getId());
        JSObject result = new JSObject();
        result.put("max", ShortcutManagerCompat.getMaxShortcutCountPerActivity(context));
        result.put("dynamic", ids);
        result.put("canPin", ShortcutManagerCompat.isRequestPinShortcutSupported(context));
        call.resolve(result);
    }

    /** Whether the launcher can be asked to put a shortcut on the home screen. */
    @PluginMethod
    public void canPin(PluginCall call) {
        JSObject result = new JSObject();
        result.put("value", ShortcutManagerCompat.isRequestPinShortcutSupported(getContext()));
        call.resolve(result);
    }

    /** Asks the launcher to pin a shortcut for the template `key` ('' for the template list). The launcher confirms it. */
    @PluginMethod
    public void pin(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        if (!ShortcutManagerCompat.isRequestPinShortcutSupported(context)) {
            result.put("requested", false);
            call.resolve(result);
            return;
        }
        String key = call.getString("key");
        String label = call.getString("label");
        boolean requested = ShortcutManagerCompat.requestPinShortcut(context, build(context, key == null ? "" : key, label == null ? "" : label, 0), null);
        result.put("requested", requested);
        call.resolve(result);
    }

    private ShortcutInfoCompat build(Context context, String key, String label, int rank) {
        String shown = label.isEmpty() ? "Capture" : label;
        Intent intent = new Intent(context, MainActivity.class); // an action is required for a shortcut's intent
        intent.setAction(ACTION_CAPTURE);
        intent.putExtra(EXTRA_KEY, key);
        return new ShortcutInfoCompat.Builder(context, ID_PREFIX + key)
            .setShortLabel(truncate(shown, 10))
            .setLongLabel(truncate(shown, 25))
            .setIcon(IconCompat.createWithResource(context, R.drawable.ic_shortcut_capture))
            .setIntent(intent)
            .setLongLived(true)
            .setRank(rank)
            .build();
    }

    private static String truncate(String text, int max) {
        return text.length() <= max ? text : text.substring(0, max - 1) + "\u2026";
    }
}
