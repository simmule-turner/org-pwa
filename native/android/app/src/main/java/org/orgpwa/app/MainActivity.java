package org.orgpwa.app;

import android.os.Bundle;
import android.view.Gravity;
import android.webkit.WebView;
import android.widget.TextView;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins are registered before super.onCreate, which builds the bridge.
        registerPlugin(ShareTargetPlugin.class);
        registerPlugin(CaptureShortcutsPlugin.class);
        registerPlugin(LocalFilesPlugin.class);
        registerPlugin(AttachmentsPlugin.class);
        registerPlugin(ApptDismissedPlugin.class);
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        // Capacitor talks to the page through a listener that only the app's own main frame can use. An older WebView lacks it
        // and falls back to a bridge that every frame (including the sandbox for source blocks) can reach. Do not run on that.
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            TextView message = new TextView(this);
            message.setText("org-pwa needs a newer Android System WebView.\n\nUpdate \"Android System WebView\" (and Chrome) in the Play Store, then open org-pwa again.");
            message.setGravity(Gravity.CENTER);
            message.setTextSize(18f);
            message.setPadding(48, 48, 48, 48);
            setContentView(message);
            return;
        }
        // Capacitor adds two JavaScript interfaces for its HTTP and cookie plugins to every frame of the WebView, and a frame
        // created later (the sandbox for source blocks) gets whatever is registered at that moment. The app uses neither
        // plugin (both are off in capacitor.config.json by default), and Capacitor's own script only uses them when present.
        webView.removeJavascriptInterface("CapacitorHttpAndroidInterface");
        webView.removeJavascriptInterface("CapacitorCookiesAndroidInterface");
        // A WebView scales its text by the phone's font-size setting; the Chrome PWA does not. Pin it to 100% so the app
        // looks the same as the PWA (Settings > Appearance still sets the font size, in both).
        webView.getSettings().setTextZoom(100);
    }
}
