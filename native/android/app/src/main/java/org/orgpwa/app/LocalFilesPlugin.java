package org.orgpwa.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Files on the device through Android's Storage Access Framework: the person picks a file (or names a new one) in the
 * system file picker, the app keeps permission to it, and can then read and write it later, across restarts, without
 * asking again. A file is known to the web app by its name, as with the browser's own file handles, so the name is
 * remembered here with the address (URI) of the file. native-platform.js turns these methods into the shape the web
 * app's platform layer expects (src-browser/platform.js, localFiles).
 */
@CapacitorPlugin(name = "LocalFiles")
public class LocalFilesPlugin extends Plugin {

    private static final String PREFS = "org-pwa-local-files";
    private static final int GRANT = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The system file picker, to open an existing file. Resolves { name }, or rejects "cancelled". */
    @PluginMethod
    public void pickOpen(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*"); // Android does not know .org, so a narrower type would hide the files
        intent.addFlags(GRANT);
        startActivityForResult(call, intent, "pickedFile");
    }

    /** The system file picker, to name a new file. Resolves { name }, or rejects "cancelled". */
    @PluginMethod
    public void pickNew(PluginCall call) {
        String name = call.getString("name");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/octet-stream"); // a text type can make a provider add its own extension to the name
        intent.putExtra(Intent.EXTRA_TITLE, name == null || name.isEmpty() ? "untitled.org" : name);
        intent.addFlags(GRANT);
        startActivityForResult(call, intent, "pickedFile");
    }

    @ActivityCallback
    private void pickedFile(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri uri = data.getData();
        try {
            // keep the permission across restarts; the picker granted it for the flags it gave
            int taken = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            getContext().getContentResolver().takePersistableUriPermission(uri, taken);
        } catch (SecurityException e) {
            call.reject("That location does not let the app keep access to the file.");
            return;
        }
        String name = displayName(uri);
        prefs().edit().putString(name, uri.toString()).apply();
        JSObject out = new JSObject();
        out.put("name", name);
        call.resolve(out);
    }

    /** Reads a file by name. Resolves { found: false } for a name that was never opened here, else { found, content }. */
    @PluginMethod
    public void read(PluginCall call) {
        String name = call.getString("name");
        Uri uri = uriFor(name);
        JSObject out = new JSObject();
        if (uri == null) {
            out.put("found", false);
            call.resolve(out);
            return;
        }
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) {
                call.reject("Could not open " + name);
                return;
            }
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[16384];
            int n;
            while ((n = in.read(chunk)) != -1) buffer.write(chunk, 0, n);
            out.put("found", true);
            out.put("content", new String(buffer.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(out);
        } catch (IOException | SecurityException e) {
            call.reject("Could not read " + name + ": " + e.getMessage());
        }
    }

    /** Replaces the contents of a file opened here. */
    @PluginMethod
    public void write(PluginCall call) {
        String name = call.getString("name");
        String content = call.getString("content");
        Uri uri = uriFor(name);
        if (uri == null || content == null) {
            call.reject("No file named " + name + " has been opened on this device.");
            return;
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) {
                call.reject("Could not open " + name + " for writing");
                return;
            }
            out.write(content.getBytes(StandardCharsets.UTF_8));
            call.resolve();
        } catch (IOException | SecurityException e) {
            call.reject("Could not write " + name + ": " + e.getMessage());
        }
    }

    /** Whether a file opened here can still be opened (it may have been moved or deleted). Resolves { value }. */
    @PluginMethod
    public void exists(PluginCall call) {
        Uri uri = uriFor(call.getString("name"));
        boolean ok = false;
        if (uri != null) {
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
                ok = in != null;
            } catch (IOException | SecurityException e) {
                ok = false;
            }
        }
        JSObject out = new JSObject();
        out.put("value", ok);
        call.resolve(out);
    }

    /** What the app may do with a file by name, without asking: "none" (never opened here), "granted", or "prompt". */
    @PluginMethod
    public void access(PluginCall call) {
        Uri uri = uriFor(call.getString("name"));
        String state = "none";
        if (uri != null) {
            state = "prompt";
            for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
                if (permission.getUri().equals(uri) && permission.isReadPermission()) state = "granted";
            }
        }
        JSObject out = new JSObject();
        out.put("value", state);
        call.resolve(out);
    }

    /** Hands a file to the person: the system "save as" screen, then the bytes (`base64`) written where they choose. */
    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/octet-stream"); // keeps the name exactly as given
        intent.putExtra(Intent.EXTRA_TITLE, name == null || name.isEmpty() ? "download" : name);
        startActivityForResult(call, intent, "savedFile");
    }

    @ActivityCallback
    private void savedFile(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject out = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            out.put("saved", false); // the person backed out: not an error
            call.resolve(out);
            return;
        }
        String encoded = call.getString("base64");
        if (encoded == null) {
            call.reject("Nothing to save");
            return;
        }
        try (OutputStream stream = getContext().getContentResolver().openOutputStream(data.getData(), "wt")) {
            if (stream == null) {
                call.reject("Could not open the chosen file for writing");
                return;
            }
            stream.write(Base64.decode(encoded, Base64.DEFAULT));
            out.put("saved", true);
            call.resolve(out);
        } catch (IOException | SecurityException | IllegalArgumentException e) {
            call.reject("Could not save the file: " + e.getMessage());
        }
    }

    private Uri uriFor(String name) {
        String stored = name == null ? null : prefs().getString(name, null);
        return stored == null ? null : Uri.parse(stored);
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.isEmpty()) return name;
            }
        }
        String last = uri.getLastPathSegment();
        return last == null || last.isEmpty() ? "untitled.org" : last;
    }
}
