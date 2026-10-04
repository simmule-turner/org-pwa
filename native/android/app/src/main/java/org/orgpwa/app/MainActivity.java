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
    }
}
