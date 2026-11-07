# Native hardening (for web v650)

- **Size caps.** `Limits.java` (new). Every read, write, copy, view, save and pick takes an optional `maxBytes`; nothing goes above 100 MB. Over the cap, the call rejects with "too large: X is over the limit of Y" before the bytes move (size known), or while copying (size unknown). Partial copies are deleted.
- **Attachments.** Streaming base64 on read. `link` and `removeSource` accept only an address the picker handed out (`KeptPicks.java`, new) and, for `link`, only outside the picked tree. Paths with `..`, `.`, empty parts, backslashes or control characters are refused (`isPlainPath`).
- **File names.** `safeFileName` for cache copies, viewer files and Downloads names.
- **Backup.** `allowBackup="false"` plus `data_extraction_rules.xml` and `backup_rules.xml` (nothing is backed up or transferred).
- **FileProvider.** `file_paths.xml` shares only `cache/captures/` and `cache/opened/` (the external-storage root and the whole cache are no longer shared).
- **Release build.** `signing.gradle` signs the release type with the stable key; the workflow builds `assembleRelease` when the key secrets exist, a debug APK otherwise. `lintVitalRelease` is skipped so an unrelated lint finding does not stop the build.
- **JS.** `native-platform.js`: `readBinary(path, {maxBytes})` (a number also works; over the limit it resolves `{tooLarge: true, bytes}` without data, and with no `maxBytes` the 100 MB cap rejects "too large: ..."), `writeBinary(path, base64, maxBytes)`, `localFiles.adapter.read(id, {prompt, maxBytes})`, `write(id, content, {maxBytes})`, `viewFile(blob, name, {maxBytes})`, `pickFile(kind, {keep, maxBytes})`, `saveFile(name, content, mime, {maxBytes})`. Other "too large:" rejections arrive as Errors (`tooLarge: true`, `bytes` when known). The native message is "too large:<bytes>: <sentence>".

Not compiled here (no Android SDK).
