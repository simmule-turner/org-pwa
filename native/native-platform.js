// Runs before the app does (scripts/sync.mjs puts a <script> for it ahead of app.js). It tells the app it is inside the
// native shell, and connects the shell's native pieces to it. Everything not set here stays the browser default until a
// native implementation is added. See src-browser/platform.js in the app for the shapes.
(function () {
  var capacitor = window.Capacitor;
  var kind = capacitor && typeof capacitor.getPlatform === 'function' ? capacitor.getPlatform() : null;

  // The platform: it has a name, and it does not register the service worker, because the shell bundles the app.
  var platform = (window.orgPwaPlatform = {
    name: kind ? 'capacitor-' + kind : 'capacitor',
    usesServiceWorker: false,
    // Which web version the app bundles, and which version of the app that is (written by scripts/sync.mjs).
    versionInfo: function () {
      return fetch('native-shell.json')
        .then(function (response) {
          return response.json();
        })
        .then(function (info) {
          return String(info.web).replace(/^org-pwa-shell-/, '') + ' (app ' + info.shell + ')';
        });
    },
  });

  // Launches from outside the app (a share, a launcher shortcut). The app is not running yet, so they are queued, and
  // orgPwaLaunch is where the shell sends one; the app replaces it with the real thing once it has started, and runs
  // whatever was queued (acceptNativeLaunches in src-browser/launch-params.js). A payload is { title, text, url, capture }.
  var queue = (window.orgPwaLaunchQueue = []);
  window.orgPwaLaunch = function (payload) {
    queue.push(payload);
  };

  function warn(what, error) {
    console.warn('org-pwa: ' + what + ' is unavailable:', error && error.message ? error.message : error);
  }

  // A native error as the page expects it: a cancelled picker is an error named AbortError, like the browser's own.
  function failure(error) {
    var message = error && error.message ? error.message : String(error);
    var result = error instanceof Error ? error : new Error(message);
    if (message === 'cancelled') result.name = 'AbortError';
    return result;
  }

  // The native plugin called `name`, or null if this build of the shell does not have it. The native bridge defines
  // Capacitor.Plugins.<name> for every plugin the native side registered, with its methods and addListener. (There is no
  // registerPlugin here: that belongs to the bundled @capacitor/core runtime, which this shell does not load.)
  function plugin(name) {
    var plugins = capacitor && capacitor.Plugins;
    return plugins && Object.prototype.hasOwnProperty.call(plugins, name) ? plugins[name] : null;
  }

  function listen(source, event, handler) {
    try {
      var listening = source.addListener(event, handler);
      if (listening && typeof listening.catch === 'function') {
        listening.catch(function (error) {
          warn(event, error);
        });
      }
    } catch (error) {
      warn(event, error);
    }
  }

  // Shares from other apps: ShareTargetPlugin raises "shareReceived" with { title, text }. One that started the app was
  // retained natively, so it arrives as soon as this listener is registered.
  var shareTarget = plugin('ShareTarget');
  if (shareTarget) {
    listen(shareTarget, 'shareReceived', function (share) {
      if (share) window.orgPwaLaunch(share); // looked up on each call, so it reaches the app's own function once that exists
    });
  }

  // Agenda reminders: the Local Notifications plugin holds them for later, so they arrive with the app closed. The app hands over
  // the whole coming list (schedule replaces whatever was held), asks for permission with a tap, and hears a tap on one as the
  // day to open. Exact timing needs the system's "Alarms & reminders" switch; without it the plugin would open that screen on every
  // schedule, so exactness is only asked for once it is granted and reminders are otherwise inexact (a few minutes' slack).
  var localNotifications = plugin('LocalNotifications');
  if (localNotifications) {
    var CHANNEL = 'appt';
    var channelReady = null;
    var ensureChannel = function () {
      if (!channelReady) {
        channelReady = Promise.resolve(
          localNotifications.createChannel({ id: CHANNEL, name: 'Agenda reminders', description: 'Appointments from your agenda, shortly before they start', importance: 4, visibility: 1 })
        ).catch(function (error) {
          channelReady = null;
          warn('the reminders channel', error);
        });
      }
      return channelReady;
    };
    var permissionOf = function (status) {
      var state = status && status.display;
      return state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'default';
    };
    var exactGranted = function () {
      return Promise.resolve(localNotifications.checkExactNotificationSetting()).then(
        function (status) {
          return !!status && status.exact_alarm === 'granted';
        },
        function () {
          return false;
        }
      );
    };
    var build = function (item, exact) {
      return {
        id: item.id,
        title: item.title,
        body: item.body,
        channelId: CHANNEL,
        autoCancel: true,
        schedule: { at: item.at.toISOString(), allowWhileIdle: true },
        isExactNotification: exact,
        extra: { day: item.day },
      };
    };
    platform.notifications = {
      supported: function () {
        return true;
      },
      permission: function () {
        return Promise.resolve(localNotifications.checkPermissions()).then(permissionOf, function () {
          return 'denied';
        });
      },
      request: function () {
        return Promise.resolve(localNotifications.requestPermissions()).then(permissionOf, function () {
          return 'denied';
        });
      },
      scheduled: true,
      // one right now: used for an appointment that is already inside its warning time when the app looks
      show: function (item) {
        return ensureChannel().then(function () {
          return localNotifications.schedule({
            notifications: [build({ id: item.id, title: item.title, body: item.body, at: new Date(Date.now() + 1000), day: item.day }, false)],
          });
        });
      },
      // replaces everything held with `list`
      schedule: function (list) {
        return Promise.all([ensureChannel(), exactGranted(), localNotifications.cancelAll()]).then(function (results) {
          if (!list.length) return null;
          var exact = results[1];
          return localNotifications.schedule({ notifications: list.map(function (item) { return build(item, exact); }) });
        });
      },
      cancelAll: function () {
        return Promise.resolve(localNotifications.cancelAll());
      },
      onTap: function (handler) {
        listen(localNotifications, 'localNotificationActionPerformed', function (event) {
          var extra = event && event.notification && event.notification.extra;
          if (extra && extra.day !== undefined) handler(extra.day);
        });
      },
      // Whether reminders can be exact: status() is 'granted' or not; request() opens the system switch and resolves the new status.
      exact: {
        status: function () {
          return exactGranted().then(function (ok) {
            return ok ? 'granted' : 'denied';
          });
        },
        request: function () {
          return Promise.resolve(localNotifications.changeExactNotificationSetting()).then(
            function (status) {
              return status && status.exact_alarm === 'granted' ? 'granted' : 'denied';
            },
            function () {
              return 'denied';
            }
          );
        },
      },
    };
  }

  // Capture templates as launcher shortcuts: CaptureShortcutsPlugin raises "captureRequested" with the template's key
  // ('' for the template list) when one is tapped, and publishes the shortcuts the app asks for.
  var shortcuts = plugin('CaptureShortcuts');
  if (shortcuts) {
    listen(shortcuts, 'captureRequested', function (request) {
      if (request) window.orgPwaLaunch({ capture: typeof request.key === 'string' ? request.key : '' });
    });
    platform.captureShortcuts = {
      supported: function () {
        return true;
      },
      set: function (list) {
        return shortcuts.setShortcuts({ shortcuts: list });
      },
      canPin: function () {
        return shortcuts.canPin().then(function (result) {
          return !!result.value;
        });
      },
      pin: function (choice) {
        return shortcuts.pin({ key: choice.key, label: choice.label }).then(function (result) {
          return !!result.requested;
        });
      },
      info: function () {
        return shortcuts.info();
      },
    };
  }

  // Attachments for local documents: the person chooses one folder, once, and they are kept inside it (AttachmentsPlugin).
  var attachments = plugin('Attachments');
  if (attachments) {
    platform.attachments = {
      supported: function () {
        return true;
      },
      folder: function () {
        return attachments.folder().then(function (result) {
          return result && result.name ? { name: result.name } : null;
        });
      },
      pickFolder: function () {
        return attachments.pickFolder().then(
          function (result) {
            return { name: result.name };
          },
          function (error) {
            throw failure(error);
          }
        );
      },
      adapter: {
        readBinary: function (path) {
          return attachments.read({ path: path }).then(function (result) {
            return result.found === false ? null : { base64: result.base64 };
          });
        },
        writeBinary: function (path, base64) {
          return attachments.write({ path: path, base64: base64 }).then(function () {
            return {};
          });
        },
        delete: function (path) {
          return attachments.remove({ path: path }).then(function () {});
        },
        exists: function (path) {
          return attachments.exists({ path: path }).then(function (result) {
            return !!result.value;
          });
        },
      },
    };
  }

  // Files on the device (Android's file picker, with the permission kept), and saving a file out through the same
  // "save as" screen. A cancelled picker must look like the browser's: an error named AbortError, which the app ignores.
  var localFiles = plugin('LocalFiles');
  if (localFiles) {
    var adapter = {
      access: function (id) {
        return localFiles.access({ name: id }).then(function (result) {
          return result.value;
        });
      },
      read: function (id, options) {
        var open = function () {
          return localFiles.read({ name: id }).then(function (result) {
            return result.found === false ? null : { content: result.content, hash: '' };
          });
        };
        // a background check reads only what is already allowed, and never asks
        if (options && options.prompt === false) {
          return adapter.access(id).then(function (state) {
            return state === 'granted' ? open() : null;
          });
        }
        return open();
      },
      write: function (id, content) {
        return localFiles.write({ name: id, content: content }).then(function () {
          return { hash: '' };
        });
      },
      exists: function (id) {
        return localFiles.exists({ name: id }).then(function (result) {
          return !!result.value;
        });
      },
    };
    platform.localFiles = {
      supported: function () {
        return true;
      },
      pickOpen: function () {
        return localFiles.pickOpen().then(
          function (result) {
            return result.name;
          },
          function (error) {
            throw failure(error);
          }
        );
      },
      pickNew: function (kv, suggestedName) {
        return localFiles.pickNew({ name: suggestedName }).then(
          function (result) {
            return result.name;
          },
          function (error) {
            throw failure(error);
          }
        );
      },
      adapter: adapter,
    };

    // The bytes cross to the native side as base64: a string is encoded as UTF-8, anything else is read as it is.
    var toBase64 = function (content) {
      if (typeof content === 'string') return Promise.resolve(btoa(unescape(encodeURIComponent(content))));
      var blob = content instanceof Blob ? content : new Blob([content]);
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
          var url = String(reader.result);
          resolve(url.slice(url.indexOf(',') + 1));
        };
        reader.onerror = function () {
          reject(reader.error);
        };
        reader.readAsDataURL(blob);
      });
    };
    // Shows a file (an attachment) in another app; the caller waits for this, so a phone with no app for it can say so.
    platform.viewFile = function (blob, name) {
      return toBase64(blob)
        .then(function (base64) {
          return localFiles.viewFile({ name: name, mime: blob.type || '', base64: base64 });
        })
        .then(function () {});
    };
    // Attaching: Android's chooser, with the camera apps beside the files (LocalFilesPlugin.pickAttachment). Whatever is chosen
    // waits in the app's cache and is read from there through the local web server, so a long video never crosses the bridge as
    // one huge string. Resolves { name, type, base64 }; backing out is an AbortError.
    platform.pickFile = function () {
      return localFiles.pickAttachment().then(
        function (picked) {
          return fetch(capacitor.convertFileSrc(picked.path))
            .then(function (response) {
              if (!response.ok) throw new Error('Could not read ' + picked.name);
              return response.blob();
            })
            .then(function (blob) {
              return toBase64(blob).then(function (base64) {
                return { name: picked.name, type: picked.type || blob.type, base64: base64 };
              });
            });
        },
        function (error) {
          throw failure(error);
        }
      );
    };

    // Resolves { where } (Downloads, on current Android), or null if the person backed out; a failure rejects, and the app says so.
    platform.saveFile = function (name, content, mime) {
      return toBase64(content)
        .then(function (base64) {
          return localFiles.saveFile({ name: name, mime: mime || '', base64: base64 });
        })
        .then(function (result) {
          return result && result.saved === false ? null : { where: (result && result.where) || 'your device' };
        });
    };
  }
})();
