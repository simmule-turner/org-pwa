# org-pwa native shell

A native (Capacitor) wrapper around the PWA in the parent folder. The PWA stays the source of truth: nothing here is a
copy of it. `npm run sync` bundles the files the PWA's own service worker lists into `www/` and copies them into the
Android project. This first version is a "hello world": the app, inside a native Android shell, and nothing native yet.

## Build the APK (no Android Studio needed)

1. On GitHub: **Actions → native-android → Run workflow**. It builds on a free Linux runner.
2. When it finishes, download the artifact `org-pwa-shell-<shell>-<web>-debug.apk` from the run page and unzip it.
3. Install it on the phone (allow installs from the app you open it with, or `adb install -r <file>.apk`).

If the build fails, open the "Show the toolchain" step first: it prints the Java, Node and Android SDK the runner has.

## What to check on the first run

- The app opens full screen, with the org-pwa icon and splash, and no browser bars.
- It looks and behaves like the PWA. Help opens, and you can create and edit a document. The top bar sits below the
  status bar, and the keyboard key lowers the keyboard as well as raising it.
- **Sharing in:** share a link or some text from another app. org-pwa appears in the Share sheet, and picking it opens
  Capture with what you shared.
- It does **not** share data with the PWA: the shell's address is `https://localhost`, so its settings, tokens and
  cached documents are its own. Enter GitHub / WebDAV / calendar settings again.
- **WebDAV and CalDAV servers must allow the origin `https://localhost`** for CORS, as they do for the PWA's own address.
  GitHub needs nothing.

## Layout and versions

- `native/` and `.github/` are not part of the PWA release zip, so the PWA runs standalone exactly as before.
- This shell has its own version (`package.json`, and `versionName` in `android/app/build.gradle`: keep them equal). The
  APK name also says which web version it bundles.
- The app id is `org.orgpwa.app`. Change it in `capacitor.config.json`, `android/app/build.gradle` and
  `android/app/src/main/res/values/strings.xml` before putting this anywhere public.
- `native-platform.js` runs before the app and tells it which platform it is on, and connects the native pieces to it.
  Native implementations of files and so on will be added there, one at a time.
- `node scripts/check-bundle.mjs` bundles the PWA and checks that glue in a real browser against a stand-in for
  Capacitor (it needs Playwright). It cannot check the Android side: that is what the CI build and the phone are for.
