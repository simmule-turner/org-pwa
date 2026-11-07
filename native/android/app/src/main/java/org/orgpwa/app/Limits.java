package org.orgpwa.app;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import com.getcapacitor.PluginCall;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

/**
 * How large a file the plugins will move through the bridge. The page may pass `maxBytes` with a call to ask for a lower
 * limit (the app's Size limits setting); nothing can raise it above HARD_MAX, because a file travels as one base64 string
 * and a very large one would run the phone out of memory. A call without `maxBytes` gets HARD_MAX. A refusal is a
 * rejection whose message is "too large:<bytes>: <sentence>" (<bytes> is -1 when unknown); native-platform.js turns it into an Error "too large: <sentence>".
 */
final class Limits {

    static final long HARD_MAX = 100L * 1024 * 1024;

    private Limits() {}

    /** The limit for this call, in bytes: its `maxBytes` if that is a positive number, never more than HARD_MAX. */
    static long cap(PluginCall call) {
        double asked = call.getData().optDouble("maxBytes", Double.NaN); // optDouble accepts an Integer, a Long or a Double
        if (Double.isNaN(asked) || asked <= 0) return HARD_MAX;
        return (long) Math.min(asked, (double) HARD_MAX);
    }

    static String describe(long bytes) {
        if (bytes >= 1024L * 1024) return String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0));
        if (bytes >= 1024) return String.format(Locale.US, "%.0f KB", bytes / 1024.0);
        return bytes + " bytes";
    }

    static String tooLarge(long size, long cap) {
        return "too large:" + size + ": " + describe(size) + " is over the limit of " + describe(cap);
    }

    /** For a size not known beforehand: reading stopped once it passed the limit. */
    static String tooLargeUnknown(long cap) {
        return "too large:-1: more than the limit of " + describe(cap);
    }

    /** The size a content provider reports for a file, or -1 if it does not say. */
    static long sizeOf(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.SIZE }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) {
                long size = cursor.getLong(0);
                return size >= 0 ? size : -1;
            }
        } catch (RuntimeException e) {
            // a provider that cannot say: the bytes are counted while reading instead
        }
        return -1;
    }

    /** About how many bytes a base64 string decodes to (a little over when it has line breaks). */
    static long decodedLength(String encoded) {
        if (encoded == null) return 0;
        long length = encoded.length();
        long padding = 0;
        if (length > 0 && encoded.charAt((int) length - 1) == '=') padding++;
        if (length > 1 && encoded.charAt((int) length - 2) == '=') padding++;
        return Math.max(0, length * 3 / 4 - padding);
    }

    /** Thrown when a stream turns out to be larger than the limit. */
    static final class TooLargeException extends IOException {
        TooLargeException(String message) {
            super(message);
        }
    }

    /** Copies a stream, stopping with TooLargeException once it has passed `cap` bytes. */
    static void copy(InputStream in, OutputStream out, long cap) throws IOException {
        byte[] chunk = new byte[65536];
        long total = 0;
        int n;
        while ((n = in.read(chunk)) != -1) {
            total += n;
            if (total > cap) throw new TooLargeException(tooLargeUnknown(cap));
            out.write(chunk, 0, n);
        }
    }

    /** Reads a whole stream into memory, within `cap`; `knownSize` is what the provider said (-1 if it did not say). */
    static ByteArrayOutputStream readAll(InputStream in, long cap, long knownSize) throws IOException {
        if (knownSize > cap) throw new TooLargeException(tooLarge(knownSize, cap));
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(knownSize > 0 ? (int) Math.min(knownSize, cap) : 8192);
        copy(in, buffer, cap);
        return buffer;
    }
}
