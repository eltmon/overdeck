package ai.overdeck.app;

import android.content.res.Configuration;
import android.os.Bundle;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatDelegate;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins register before the bridge starts in super.onCreate.
        registerPlugin(OverdeckKeysPlugin.class);
        registerPlugin(OverdeckAppearancePlugin.class);
        // PAN-5041: the stored appearance applies before the bridge creates the WebView.
        AppCompatDelegate.setDefaultNightMode(OverdeckAppearancePlugin.nightMode(OverdeckAppearancePlugin.stored(this)));
        super.onCreate(savedInstanceState);
        OverdeckAppearancePlugin.applyBackground(this, getBridge().getWebView());
    }

    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // System appearance changed live (the manifest handles uiMode, so the activity is not recreated).
        if (getBridge() != null) OverdeckAppearancePlugin.applyBackground(this, getBridge().getWebView());
    }
}
