// Makes swiping an agenda reminder away end that appointment's other reminders, even with the app closed.
//
// @capacitor/local-notifications gives every notification a "dismiss" receiver that only forgets the notification's own record,
// and tells the web app nothing. The shell schedules an appointment's repeats (every appt-display-interval minutes) as separate
// notifications grouped "appt-<id>", so after a swipe the next one still arrives. This replaces that one receiver with a copy that,
// for a group starting "appt-", also cancels the group's other pending alarms and writes the group into the "org_pwa_dismissed"
// preferences, which ApptDismissedPlugin hands to the web app so it does not schedule them again.
//
// It is applied to node_modules (by scripts/sync.mjs, before the Android project is built) and is safe to run again. It only
// replaces the file it was written against (checked by hash): if the plugin is upgraded the build stops here, so the change is
// looked at again rather than silently lost.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '..', 'node_modules/@capacitor/local-notifications/android/src/main/kotlin/com/capacitorjs/plugins/localnotifications/NotificationDismissReceiver.kt');
const ORIGINAL_SHA256 = 'd731cce6f05fb5a111f450cb07df473de9b16e1122ae64fcbbcfc9791cb308a1'; // @capacitor/local-notifications 8.3.1
const MARKER = 'org-pwa patch';

const PATCHED = `package com.capacitorjs.plugins.localnotifications

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import com.getcapacitor.Logger

/**
 * Receiver called when a notification is dismissed by the user.
 *
 * (${MARKER}, scripts/patch-local-notifications.mjs.) An agenda reminder is one of several notifications of a group named
 * "appt-<id>". Swiping one away also cancels the group's other pending alarms and records the group in the "org_pwa_dismissed"
 * preferences, which the app reads (ApptDismissedPlugin) so it does not schedule them again.
 */
class NotificationDismissReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val intExtra = intent.getIntExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, Int.MIN_VALUE)
        if (intExtra == Int.MIN_VALUE) {
            Logger.error(Logger.tags("LN"), "Invalid notification dismiss operation", null)
            return
        }
        val storage = NotificationStorage(context)
        val existing = storage.getSavedNotification(intExtra.toString())
        val group = existing?.group
        if (group != null && group.startsWith("appt-")) {
            endReminders(context, storage, group)
        }
        if (LocalNotificationManager.isSafeToForget(existing)) {
            storage.deleteNotification(intExtra.toString())
        }
    }

    private fun endReminders(context: Context, storage: NotificationStorage, group: String) {
        context.getSharedPreferences(DISMISSED_STORE, Context.MODE_PRIVATE).edit().putLong(group, System.currentTimeMillis()).apply()
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        for (idString in storage.getSavedNotificationIds()) {
            val id = idString.toIntOrNull() ?: continue
            val other = storage.getSavedNotification(idString) ?: continue
            if (other.group != group || other.isTriggered()) continue
            // the same pending intent the plugin made when it scheduled this one (LocalNotificationManager.cancelTimerForNotification)
            var flags = PendingIntent.FLAG_NO_CREATE
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags = flags or PendingIntent.FLAG_MUTABLE
            }
            val pending = PendingIntent.getBroadcast(context, id, Intent(context, TimedNotificationPublisher::class.java), flags)
            if (pending != null) {
                alarmManager.cancel(pending)
                pending.cancel()
            }
            storage.deleteNotification(idString)
        }
    }

    companion object {
        // Must match STORE in org.orgpwa.app.ApptDismissedPlugin.
        const val DISMISSED_STORE = "org_pwa_dismissed"
    }
}
`;

export function patchLocalNotifications() {
  if (!fs.existsSync(target)) throw new Error(`${target} is missing: run npm ci first`);
  const current = fs.readFileSync(target, 'utf8');
  if (current.includes(MARKER)) return 'already patched';
  const sha = crypto.createHash('sha256').update(current).digest('hex');
  if (sha !== ORIGINAL_SHA256) {
    throw new Error(`NotificationDismissReceiver.kt is not the version scripts/patch-local-notifications.mjs was written against (sha256 ${sha}). Read the new one, update the patch and ORIGINAL_SHA256.`);
  }
  fs.writeFileSync(target, PATCHED);
  return 'patched';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(`local-notifications dismiss receiver: ${patchLocalNotifications()}`);
