package org.orgpwa.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins are registered before super.onCreate, which builds the bridge.
        registerPlugin(ShareTargetPlugin.class);
        registerPlugin(CaptureShortcutsPlugin.class);
        registerPlugin(LocalFilesPlugin.class);
        registerPlugin(AttachmentsPlugin.class);
        super.onCreate(savedInstanceState);
        // A WebView scales its text by the phone's font-size setting; the Chrome PWA does not. Pin it to 100% so the app
        // looks the same as the PWA (Settings > Appearance still sets the font size, in both).
        getBridge().getWebView().getSettings().setTextZoom(100);
    }
}
