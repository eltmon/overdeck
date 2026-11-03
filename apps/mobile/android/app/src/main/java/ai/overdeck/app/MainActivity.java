package ai.overdeck.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins register before the bridge starts in super.onCreate.
        registerPlugin(OverdeckKeysPlugin.class);
        registerPlugin(OverdeckPushPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
