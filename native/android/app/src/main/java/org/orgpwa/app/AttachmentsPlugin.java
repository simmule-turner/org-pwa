package org.orgpwa.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.util.Base64OutputStream;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSArray;
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
import org.json.JSONException;
import org.json.JSONObject;

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

    /**
     * Reads a file by its path inside the folder. Resolves { found: false } if it is not there, else { found, base64 }.
     * `maxBytes` (optional, never above 100 MB) is the largest file to read; a larger one rejects "too large: ...".
     */
    @PluginMethod
    public void read(PluginCall call) {
        String path = call.getString("path");
        long cap = Limits.cap(call);
        Uri linked = linkedUri(path);
        DocumentFile file = linked == null ? locate(path, false) : null;
        JSObject out = new JSObject();
        if (linked == null && (file == null || !file.isFile())) {
            out.put("found", false);
            call.resolve(out);
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        Uri source = linked != null ? linked : file.getUri();
        long size = linked != null ? Limits.sizeOf(resolver, linked) : file.length();
        if (size > cap) {
            call.reject(Limits.tooLarge(size, cap));
            return;
        }
        try (InputStream in = resolver.openInputStream(source)) {
            if (in == null) {
                out.put("found", false);
                call.resolve(out);
                return;
            }
            // encoded as it is read, so the file's bytes and its base64 text are not both held at once
            ByteArrayOutputStream encoded = new ByteArrayOutputStream(size > 0 ? (int) Math.min(size * 4 / 3 + 16, cap * 4 / 3 + 16) : 8192);
            try (Base64OutputStream base64 = new Base64OutputStream(encoded, Base64.NO_WRAP)) {
                Limits.copy(in, base64, cap);
            }
            out.put("found", true);
            out.put("base64", encoded.toString("US-ASCII"));
            call.resolve(out);
        } catch (Limits.TooLargeException e) {
            call.reject(e.getMessage());
        } catch (IOException | SecurityException e) {
            call.reject("Could not read " + path + ": " + e.getMessage());
        }
    }

    /**
     * Writes a file (`base64` is its bytes) at a path inside the folder, making the folders on the way and replacing any earlier copy.
     * `maxBytes` (optional, never above 100 MB) is the largest file to write; a larger one rejects "too large: ...".
     */
    @PluginMethod
    public void write(PluginCall call) {
        String path = call.getString("path");
        String encoded = call.getString("base64");
        if (encoded == null) {
            call.reject("Nothing to write");
            return;
        }
        long cap = Limits.cap(call);
        long size = Limits.decodedLength(encoded);
        if (size > cap) {
            call.reject(Limits.tooLarge(size, cap));
            return;
        }
        if (!isPlainPath(path)) {
            call.reject("Could not create " + path + " in the attachments folder: not a plain relative path.");
            return;
        }
        setLink(path, null); // a file written here replaces a link kept at the same path
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
        String path = call.getString("path");
        DocumentFile file = locate(path, false);
        JSObject out = new JSObject();
        out.put("value", linkedUri(path) != null || (file != null && file.isFile()));
        call.resolve(out);
    }

    /** Deletes a file by its path inside the folder. Resolves { deleted }: false if it was not there. */
    @PluginMethod
    public void remove(PluginCall call) {
        String path = call.getString("path");
        boolean unlinked = linkedUri(path) != null; // removing a link leaves the file it points to alone
        setLink(path, null);
        DocumentFile file = locate(path, false);
        JSObject out = new JSObject();
        out.put("deleted", unlinked || (file != null && file.delete()));
        call.resolve(out);
    }

    /**
     * What is in a folder, by its path inside the chosen folder ("" or no path is the chosen folder itself). Resolves { names, entries }:
     * `names` the file names (older web code reads only this), and `entries` every file and folder as { name, dir, size, modified }
     * (size in bytes and modified in milliseconds since the epoch, for a file, and only when Android reports them). Both are empty
     * if there is no such folder.
     */
    @PluginMethod
    public void list(PluginCall call) {
        JSObject out = new JSObject();
        JSArray names = new JSArray();
        JSArray entries = new JSArray();
        String path = call.getString("path", "");
        boolean root = path == null || path.isEmpty();
        DocumentFile folder = null;
        if (root) {
            Uri tree = treeUri();
            if (tree != null && hasPermission(tree)) folder = DocumentFile.fromTreeUri(getContext(), tree);
        } else if (isPlainPath(path)) {
            folder = locate(path, false);
        } else {
            out.put("names", names);
            out.put("entries", entries);
            call.resolve(out);
            return;
        }
        java.util.HashSet<String> seen = new java.util.HashSet<>();
        if (folder != null && folder.isDirectory()) {
            for (DocumentFile child : folder.listFiles()) {
                String name = child.getName();
                if (name == null || !(child.isFile() || child.isDirectory())) continue;
                JSObject entry = new JSObject();
                entry.put("name", name);
                entry.put("dir", child.isDirectory());
                if (child.isFile()) {
                    names.put(name);
                    long length = child.length();
                    if (length >= 0) entry.put("size", length);
                    long modified = child.lastModified();
                    if (modified > 0) entry.put("modified", modified);
                }
                seen.add(name);
                entries.put(entry);
            }
        }
        String prefix = root ? "" : path + "/";
        JSONObject links = links();
        java.util.Iterator<String> keys = links.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (key.startsWith(prefix) && key.indexOf('/', prefix.length()) < 0) {
                String name = key.substring(prefix.length());
                names.put(name);
                if (seen.add(name)) {
                    JSObject entry = new JSObject();
                    entry.put("name", name);
                    entry.put("dir", false);
                    entries.put(entry);
                }
            }
        }
        out.put("names", names);
        out.put("entries", entries);
        call.resolve(out);
    }

    /**
     * org-attach-method ln: keeps a link at a path inside the folder to a file the person picked (`uri`, from pickAttachment with
     * keep), instead of a copy. read, exists, list and remove then treat the path as a file. The file must still be readable
     * later, so access to it has to have been kept. Only a file picked this way in this run of the app can be linked, and
     * never one inside the attachments folder itself.
     */
    @PluginMethod
    public void link(PluginCall call) {
        String path = call.getString("path");
        String uri = call.getString("uri");
        if (uri == null || !isPlainPath(path)) {
            call.reject("Nothing to link");
            return;
        }
        if (!KeptPicks.contains(uri)) {
            call.reject("That file was not picked to be linked.");
            return;
        }
        Uri target = Uri.parse(uri);
        if (insideTree(target)) {
            call.reject("That file is inside the attachments folder, so it cannot be linked.");
            return;
        }
        boolean readable = false;
        for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (permission.getUri().equals(target) && permission.isReadPermission()) readable = true;
        }
        if (!readable) {
            call.reject("Android did not keep access to that file, so it cannot be linked.");
            return;
        }
        setLink(path, uri);
        call.resolve();
    }

    /**
     * org-attach-method mv: deletes the file the person picked, once its copy is attached. Only a file picked for a move in
     * this run of the app, with write access kept, can be deleted. Rejects if Android refuses.
     */
    @PluginMethod
    public void removeSource(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || !KeptPicks.contains(uri)) {
            call.reject("That file was not picked for a move.");
            return;
        }
        Uri target = Uri.parse(uri);
        boolean writable = false;
        for (UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (permission.getUri().equals(target) && permission.isWritePermission()) writable = true;
        }
        if (!writable) {
            call.reject("Android did not keep write access to that file, so it cannot be deleted.");
            return;
        }
        try {
            if (DocumentsContract.deleteDocument(getContext().getContentResolver(), target)) {
                KeptPicks.remove(uri);
                call.resolve();
            } else call.reject("The app that holds that file did not delete it.");
        } catch (SecurityException | java.io.FileNotFoundException | IllegalArgumentException e) {
            call.reject("Could not delete the original: " + (e.getMessage() == null ? "not allowed" : e.getMessage()));
        }
    }

    private static final String LINKS = "links";

    /** The links kept so far: { path inside the folder: uri of the file }. */
    private JSONObject links() {
        try {
            return new JSONObject(prefs().getString(LINKS, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private Uri linkedUri(String path) {
        String uri = !isPlainPath(path) ? null : links().optString(path, null);
        return uri == null || uri.isEmpty() ? null : Uri.parse(uri);
    }

    /** Keeps (or with null, drops) the link at a path. */
    private void setLink(String path, String uri) {
        if (path == null) return;
        JSONObject links = links();
        try {
            if (uri == null) {
                if (!links.has(path)) return;
                links.remove(path);
            } else links.put(path, uri);
        } catch (JSONException e) {
            return;
        }
        prefs().edit().putString(LINKS, links.toString()).apply();
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
        if (!isPlainPath(path)) return null;
        DocumentFile current = DocumentFile.fromTreeUri(getContext(), tree);
        if (current == null) return null;
        String[] parts = path.split("/");
        for (int i = 0; i < parts.length; i++) {
            String part = parts[i];
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

    /**
     * Whether `path` is a plain relative path inside the folder: parts separated by "/", none of them empty (so no leading or
     * trailing "/" and no "//"), "." or "..", and no backslash or control character anywhere.
     */
    static boolean isPlainPath(String path) {
        if (path == null || path.isEmpty()) return false;
        for (int i = 0; i < path.length(); i++) {
            char c = path.charAt(i);
            if (c == '\\' || c < 0x20 || c == 0x7f) return false;
        }
        for (String part : path.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..")) return false;
        }
        return true;
    }

    /** Whether a document address is the chosen attachments folder or something inside it. Cannot tell: counts as inside. */
    private boolean insideTree(Uri target) {
        Uri tree = treeUri();
        if (tree == null) return false;
        try {
            if (!DocumentsContract.isDocumentUri(getContext(), target)) return false;
            if (!java.util.Objects.equals(tree.getAuthority(), target.getAuthority())) return false;
            String parent = DocumentsContract.getTreeDocumentId(tree);
            String child = DocumentsContract.getDocumentId(target);
            return child.equals(parent) || child.startsWith(parent.endsWith("/") ? parent : parent + "/");
        } catch (IllegalArgumentException e) {
            return true;
        }
    }
}
