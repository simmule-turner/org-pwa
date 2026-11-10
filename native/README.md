# org-pwa native shell

A native (Capacitor) wrapper around the PWA in the parent folder. The PWA stays the source of truth: nothing here is a
copy of it. `npm run sync` bundles the files the PWA's own service worker lists into `www/` and copies them into the
Android project. This first version is a "hello world": the app, inside a native Android shell, and nothing native yet.

## Build the APK (no Android Studio needed)

1. On GitHub: **Actions → native-android → Run workflow**. It builds on a free Linux runner.
2. When it finishes, download the artifact `org-pwa-shell-<shell>-<web>-release.apk` from the run page and unzip it. (Without
   a signing key of your own the build is a debug one and ends `-debug-one-off-key.apk`: see *Keeping your data across updates*.)
3. Install it on the phone (allow installs from the app you open it with, or `adb install -r <file>.apk`).

If the build fails, open the "Show the toolchain" step first: it prints the Java, Node and Android SDK the runner has.

## Keeping your data across updates (one-time setup)

Android installs a new build over the one on the phone only if both were signed with the **same key**. Without a key of
your own, every CI build gets a one-off key (its file name ends in `-one-off-key`), so each new build has to be installed
by uninstalling the old one first, which also deletes the app's settings, tokens and its access to your local files. With
your own key, an update installs over the old app and keeps all of that.

You do this once, on any computer with a JDK (Android Studio includes one):

1. **Make the key.** It asks for a password (use the same one if it asks twice) and some name fields (anything will do):

       keytool -genkeypair -keystore orgpwa.keystore -alias orgpwa -keyalg RSA -keysize 4096 -validity 36500

2. **Back up `orgpwa.keystore`** somewhere safe. If you lose it, you can never update an installed copy again, only
   reinstall. Never commit it, and never paste it or its password anywhere public: this repository is public.
3. **Turn it into text** for GitHub:
   - Linux: `base64 -w0 orgpwa.keystore`
   - macOS: `base64 -i orgpwa.keystore`
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("orgpwa.keystore"))`
4. **Add four secrets** on GitHub: the repository's **Settings → Secrets and variables → Actions → New repository secret**.
   - `ORGPWA_KEYSTORE_BASE64`: the text from step 3
   - `ORGPWA_KEYSTORE_PASSWORD`: the password
   - `ORGPWA_KEY_ALIAS`: `orgpwa`
   - `ORGPWA_KEY_PASSWORD`: the same password
5. **Run the workflow.** Its run page now has a **Signing** summary: `Key: stable` and the certificate's fingerprint. Any two
   builds that show the same fingerprint can update each other.
6. **Move over once.** The app on the phone now was signed with some other key, so uninstall it, install the new APK, and
   from then on install each new build over the top. Before uninstalling, use **Settings → Backup → Export Settings**,
   and import that file afterwards. You will need to pick your local files again once.

## What to check on the first run

- The app opens full screen, with the org-pwa icon and splash, and no browser bars.
- It looks and behaves like the PWA. Help opens, and you can create and edit a document. The top bar sits below the
  status bar, and the keyboard key lowers the keyboard as well as raising it.
- **Sharing in** (this and the next two did nothing in 0.3.1 and earlier, because the app could not see the native
  plugins; fixed in 0.3.2): share a link or some text from another app. org-pwa appears in the Share sheet, and picking it opens
  Capture with what you shared.
- **Capture shortcuts:** long-press the app icon on the home screen or app drawer. A list pops up with one entry per
  capture template (as many as your launcher allows, in the order they are in Settings > Capture Templates). Tap one to
  open that template; *Web page or text* is the one for things shared in from other apps.
  - **To get an icon on the home screen:** while that list is showing, press and hold one of the entries and drag it out
    onto the home screen. The new icon opens that template directly. Or run the command *Add a capture icon to the home
    screen*, pick a template (or *the template list*), and confirm when the launcher asks "add to home screen?".
  - **If the list is missing the templates, or empty:** run *Show display measurements*, press OK to copy, and send me
    the "launcher shortcuts" line. It says what the launcher has and whether publishing failed (a failure also shows in
    the status line when the app starts).
- **Attachments:** the Open button on an attachment hands the file to whichever app you have for its type. If no app can
  open it, the status line says so.
- **Files on the device:** File > Open says **Local file** and opens Android's file picker, which now starts in
  `Documents/org-pwa` (in the shared Documents folder; pick any other folder if you like). The app keeps access to the
  file, so it can be edited, saved, and reopened from the recent list later without picking it again. Save As > Local
  file names a new one, also starting there.
- **Agenda reminders (0.7.0, new native dependency `@capacitor/local-notifications`):** in Settings > Agenda notifications turn
  the first line on, tap **Allow notifications**, and give an item a time of day a few minutes ahead (for example
  `* Test <2026-10-08 Thu 14:35>`). A system notification should arrive 10 minutes before it, **with the app closed**;
  tapping it opens that day in the Agenda. Without **Exact timing** (the button under it) Android may be a few minutes
  late. `npm run sync` (the workflow does this) picks the plugin up; nothing else changes in the Android project.
- **Folder listing (0.7.11):** in the web app's Files view, *This device* now lists the whole org-pwa folder, including its subfolders, and shows each file's size; sort by date works too. To check: open *File → Open → This device*, enter a subfolder and back, sort by *Date*, and open a file. An older shell shows the org-pwa folder as empty.
- **WebView hardening (0.7.10):** the app opens and works as before. If a phone's Android System WebView is too old for it, the app now shows a message asking you to update it (Play Store: *Android System WebView*, and Chrome) and does not start. To check the sandbox: in Chrome on a computer, open `chrome://inspect`, inspect org-pwa's WebView, and run `typeof CapacitorHttpAndroidInterface` in the page's console: it should say `undefined`. Also run a JavaScript block (C-c C-c) and the sandbox probe once, to confirm blocks still run.
- **Hardening (0.7.9):** none of this changes how the app looks; check that nothing broke and that the limits hold.
  - *Backup off:* Settings > Apps > org-pwa > Storage shows no backup; after a reinstall the app starts empty (documents come back only from your sync backend or local files).
  - *Size limits:* attach a file bigger than the Attachment limit (Settings > Limits) from the picker: it is refused with a "too large" message, nothing is left in the app's cache, and a file under the limit still attaches. Open a local `.org` file bigger than the Org file limit: you are asked, not frozen. Try a 100 MB+ file: refused before it loads.
  - *Attachments:* attach with copy, then with move and link (`org-attach-method`). Move deletes the original only after you agree. Link keeps the file in place and opens it later. Open an attachment in another app, and a file whose name has odd characters or `..`.
  - *Local files:* open, edit, save and reopen from the recent list a file in `Documents/org-pwa`, one on another storage provider (Drive, SD card), and one inside a picked folder. Save As to Downloads; a name with slashes or odd characters is cleaned, not rejected.
  - *Sharing:* share text, a link and a photo into org-pwa. View a file from an attachment (the other app can open it); then confirm another app cannot open anything else of ours.
  - *Reminders:* the agenda notification test above still arrives with the app closed.
  - *Release build:* the CI run produces a signed release APK (the stable key keeps your data on update) and installs over 0.7.8 without losing data.
- **Moving and linking attachments (0.7.8):** with `org-attach-method` set to `mv` or `ln` (or *Attach and move*, *Attach a link*), *Attach* opens Android's document picker, with no camera entries. A move deletes the original after the copy is attached and the person agrees; a link keeps the picked file where it is and reads it through the stored link (`AttachmentsPlugin.link` and `removeSource`, `LocalFilesPlugin.pickAttachment` with `keep`). To test: attach a PDF with `ln`, close the app, open the attachment; attach another with `mv` and confirm the original is gone from Files.
- **Swiping a reminder away (0.7.7):** with a reminder showing, swipe it out of the shade. The appointment's later reminders
  should not arrive (even with the app closed), and tapping one does the same. `npm run sync` patches the plugin's dismiss
  receiver to do this (`scripts/patch-local-notifications.mjs`); the build stops there if the plugin is upgraded, so the patch
  is looked at again.
- **Attaching a photo or video:** *Attach* opens Android's chooser. Besides your file sources it lists the camera apps as
  **Take a photo (…)** and **Record a video (…)**. Take one: it should come back attached. Try a video of a minute or
  two as well, and tell me if it is slow or fails.
- **Saving a file out:** exports and settings backups go straight into **Downloads**, with no screen in between, and the
  status line says `Saved "name" to Downloads.` (On Android 9 and older it still opens the "save as" screen.)
- **The org-pwa folder:** the first time something needs it (a local file's first attachment, or a `local:` name that is
  not found), Android's folder picker opens, starting at `Documents/org-pwa`. Choose a folder and tap "Use this folder".
  - **Attachments** are written under `data/xx/yyyy/` inside it, and Open, Save and Delete work as on GitHub or WebDAV.
  - **`local:` files** are found in it by name, anywhere `github:` or `webdav:` can be written: `org-agenda-files`,
    `org-contacts-files`, `org-refile-targets`, a capture template's `file`, a link, or `#+INCLUDE`. `local:contacts.org`
    is `contacts.org` in the folder; `local:areas/home.org` is in its `areas` folder. A file opened through the file
    picker is found by name first. Capture and refile into such a file can write to it (and create it, for capture).
  - The command *Choose the org-pwa folder* changes it.
- **Placing the app bar:** if the bar sits too low or too high, run the command *Show display measurements*, press OK
  to copy the numbers, and send them.
- It does **not** share data with the PWA: the shell's address is `https://localhost`, so its settings, tokens and
  cached documents are its own. Enter GitHub / WebDAV / calendar settings again.
- **WebDAV, CalDAV and CardDAV servers must allow the origin `https://localhost`** for CORS, as they do for the PWA's own address.
  GitHub needs nothing.

## Permissions

`AndroidManifest.xml` declares what the web view is allowed to ask the phone for: `INTERNET`; `ACCESS_COARSE_LOCATION` and
`ACCESS_FINE_LOCATION` (a script's `org.location.get()` and the Settings button that fills in latitude and longitude);
`RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` (Attach > Record audio); and, from the local-notifications plugin, notifications and
exact alarms. Photos and videos go to the phone's camera app, which needs no permission of its own, so `CAMERA` is left out
on purpose. Without a declaration Android never shows its dialog and the request is refused.

## Layout and versions

- 0.4.0 removed the fixed "Capture a note" shortcut. If you copy the changes by hand, also delete
  `native/android/app/src/main/res/xml/shortcuts.xml` (the build works without deleting it, but nothing uses it).

- `native/` and `.github/` are not part of the PWA release zip, so the PWA runs standalone exactly as before.
- This shell has its own version (`package.json`, and `versionName` in `android/app/build.gradle`: keep them equal). The
  APK name also says which web version it bundles.
- The app id is `org.orgpwa.app`. Change it in `capacitor.config.json`, `android/app/build.gradle` and
  `android/app/src/main/res/values/strings.xml` before putting this anywhere public.
- `native-platform.js` runs before the app and tells it which platform it is on, and connects the native pieces to it.
  Native implementations of files and so on will be added there, one at a time.
- `node scripts/check-bundle.mjs` bundles the PWA and checks that glue in a real browser against a stand-in for
  Capacitor (it needs Playwright). It cannot check the Android side: that is what the CI build and the phone are for.
