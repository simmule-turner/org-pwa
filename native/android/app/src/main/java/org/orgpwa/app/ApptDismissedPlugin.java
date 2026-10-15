package org.orgpwa.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import java.util.Map;
import org.json.JSONException;

/**
 * Which agenda reminders were swiped away in the notification shade. The Local Notifications plugin's dismiss receiver, patched
 * by scripts/patch-local-notifications.mjs, cancels the rest of that appointment's reminders and writes its group ("appt-<id>")
 * into the "org_pwa_dismissed" preferences, even with the app closed. The web app reads the groups here the next time it looks at
 * the agenda, so that it does not schedule the appointment's reminders again, and forgets the ones whose appointment has started.
 */
@CapacitorPlugin(name = "ApptDismissed")
public class ApptDismissedPlugin extends Plugin {

    // Must match NotificationDismissReceiver.DISMISSED_STORE in scripts/patch-local-notifications.mjs.
    private static final String STORE = "org_pwa_dismissed";

    private SharedPreferences store() {
        return getContext().getSharedPreferences(STORE, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void list(PluginCall call) {
        JSArray groups = new JSArray();
        for (Map.Entry<String, ?> entry : store().getAll().entrySet()) groups.put(entry.getKey());
        JSObject result = new JSObject();
        result.put("groups", groups);
        call.resolve(result);
    }

    @PluginMethod
    public void forget(PluginCall call) {
        JSArray groups = call.getArray("groups");
        if (groups == null) {
            call.resolve();
            return;
        }
        SharedPreferences.Editor editor = store().edit();
        try {
            for (int i = 0; i < groups.length(); i++) editor.remove(groups.getString(i));
        } catch (JSONException error) {
            call.reject("groups must be strings", error);
            return;
        }
        editor.apply();
        call.resolve();
    }
}
