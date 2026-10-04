package org.orgpwa.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
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

/**
 * The org-pwa folder: a place for the attachments of local documents, and for local files found by name. A local document is
 * one file the person picked, and access to one file is not access to the folder around it, so an attachment has nowhere to go
 * beside it, and `local:contacts.org` has nowhere to be found. Instead the person chooses ONE folder, once, in Android's folder
 * picker (it starts at Documents/org-pwa); the app keeps permission to it, and files are read and written inside it by relative
 * path (data/xx/yyyy/name for attachments, as on GitHub and WebDAV; contacts.org for a local file). native-platform.js turns these methods into the shape the web
 * app's platform layer expects (src-browser/platform.js, attachments).
 */
@CapacitorPlugin(name = "Attachments")
public class AttachmentsPlugin extends Plugin {

    private static final String PREFS = "org-pwa-attachments";
    private static final String TREE = "tree";
    private static final int GRANT = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Android's folder picker. Resolves { name } (the folder's name), or rejects "cancelled". */
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(GRANT);
        Locations.startInOrgPwaFolder(intent);
        startActivityForResult(call, intent, "pickedFolder");
    }

    @ActivityCallback
    private void pickedFolder(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri tree = data.getData();
        try {
            int taken = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            getContext().getContentResolver().takePersistableUriPermission(tree, taken);
        } catch (SecurityException e) {
            call.reject("That folder does not let the app keep access to it.");
            return;
        }
        DocumentFile root = DocumentFile.fromTreeUri(getContext(), tree);
        String name = root != null && root.getName() != null ? root.getName() : "attachments";
        prefs().edit().putString(TREE, tree.toString()).apply();
        JSObject out = new JSObject();
        out.put("name", name);
        call.resolve(out);
    }

    /** The folder chosen earlier, if it is still there and still allowed: { name }, or {} for none. */
    @PluginMethod
    public void folder(PluginCall call) {
        JSObject out = new JSObject();
        Uri tree = treeUri();
        if (tree != null && hasPermission(tree)) {
            DocumentFile root = DocumentFile.fromTreeUri(getContext(), tree);
            if (root != null && root.exists() && root.getName() != null) out.put("name", root.getName());
        }
        call.resolve(out);
    }

    /** Reads a file by its path inside the folder. Resolves { found: false } if it is not there, else { found, base64 }. */
    @PluginMethod
    public void read(PluginCall call) {
        String path = call.getString("path");
        DocumentFile file = locate(path, false);
        JSObject out = new JSObject();
        if (file == null || !file.isFile()) {
            out.put("found", false);
            call.resolve(out);
            return;
        }
        try (InputStream in = getContext().getContentResolver().openInputStream(file.getUri())) {
            if (in == null) {
                out.put("found", false);
                call.resolve(out);
                return;
            }
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[65536];
            int n;
            while ((n = in.read(chunk)) != -1) buffer.write(chunk, 0, n);
            out.put("found", true);
            out.put("base64", Base64.encodeToString(buffer.toByteArray(), Base64.NO_WRAP));
            call.resolve(out);
        } catch (IOException | SecurityException e) {
            call.reject("Could not read " + path + ": " + e.getMessage());
        }
    }

    /** Writes a file (`base64` is its bytes) at a path inside the folder, making the folders on the way and replacing any earlier copy. */
    @PluginMethod
    public void write(PluginCall call) {
        String path = call.getString("path");
        String encoded = call.getString("base64");
        if (encoded == null) {
            call.reject("Nothing to write");
            return;
        }
        DocumentFile file = locate(path, true);
        if (file == null || !file.isFile()) {
            call.reject("Could not create " + path + " in the attachments folder. Is a folder chosen?");
            return;
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(file.getUri(), "wt")) {
            if (out == null) {
                call.reject("Could not open " + path + " for writing");
                return;
            }
            out.write(Base64.decode(encoded, Base64.DEFAULT));
            call.resolve();
        } catch (IOException | SecurityException | IllegalArgumentException e) {
            call.reject("Could not write " + path + ": " + e.getMessage());
        }
    }

    /** Whether a file is there, by its path inside the folder. Resolves { value }. */
    @PluginMethod
    public void exists(PluginCall call) {
        DocumentFile file = locate(call.getString("path"), false);
        JSObject out = new JSObject();
        out.put("value", file != null && file.isFile());
        call.resolve(out);
    }

    /** Deletes a file by its path inside the folder. Resolves { deleted }: false if it was not there. */
    @PluginMethod
    public void remove(PluginCall call) {
        DocumentFile file = locate(call.getString("path"), false);
        JSObject out = new JSObject();
        out.put("deleted", file != null && file.delete());
        call.resolve(out);
    }

    private Uri treeUri() {
        String stored = prefs().getString(TREE, null);
        return stored == null ? null : Uri.parse(stored);
    }

    private boolean hasPermission(Uri tree) {
        for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (permission.getUri().equals(tree) && permission.isReadPermission() && permission.isWritePermission()) return true;
        }
        return false;
    }

    /**
     * The file at `path` (parts separated by "/") inside the chosen folder, or null if it is not there, no folder is chosen,
     * or the path is not a plain relative one (an empty part, "." or ".." is refused, so a path can never leave the folder).
     * With `create`, the folders and an empty file are made on the way. "application/octet-stream" keeps the name exactly
     * as given: a provider may add an extension for a more specific type.
     */
    private DocumentFile locate(String path, boolean create) {
        Uri tree = treeUri();
        if (tree == null || path == null || path.isEmpty() || !hasPermission(tree)) return null;
        DocumentFile current = DocumentFile.fromTreeUri(getContext(), tree);
        if (current == null) return null;
        String[] parts = path.split("/");
        for (int i = 0; i < parts.length; i++) {
            String part = parts[i];
            if (part.isEmpty() || part.equals(".") || part.equals("..")) return null;
            boolean last = i == parts.length - 1;
            DocumentFile next = current.findFile(part);
            if (next == null) {
                if (!create) return null;
                next = last ? current.createFile("application/octet-stream", part) : current.createDirectory(part);
                if (next == null) return null;
            }
            current = next;
        }
        return current;
    }
}
