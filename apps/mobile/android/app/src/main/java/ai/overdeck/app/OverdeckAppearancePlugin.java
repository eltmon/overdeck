package ai.overdeck.app;

import android.app.Activity;
import android.content.Context;
import android.content.res.Configuration;
import android.webkit.WebView;

import androidx.appcompat.app.AppCompatDelegate;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The `OverdeckAppearance` plugin on Android (PAN-5041): stores the phone app's appearance and applies it. */
@CapacitorPlugin(name = "OverdeckAppearance")
public class OverdeckAppearancePlugin extends Plugin {
    static final String PREFS = "overdeck_appearance";
    static final String KEY = "appearance";
    static final int LIGHT_BACKGROUND = 0xFFFFFFFF; // :root --background
    static final int DARK_BACKGROUND = 0xFF080B10;  // .dark --background

    static int nightMode(String appearance) {
        if ("light".equals(appearance)) return AppCompatDelegate.MODE_NIGHT_NO;
        if ("dark".equals(appearance)) return AppCompatDelegate.MODE_NIGHT_YES;
        return AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM;
    }

    static String stored(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "system");
    }

    /** Sets the WebView background to the page's background color for the current night mode. */
    static void applyBackground(Activity activity, WebView webView) {
        int uiMode = activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        webView.setBackgroundColor(uiMode == Configuration.UI_MODE_NIGHT_YES ? DARK_BACKGROUND : LIGHT_BACKGROUND);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String appearance = call.getString("appearance", "system");
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, appearance).apply();
        getActivity().runOnUiThread(() -> {
            AppCompatDelegate.setDefaultNightMode(nightMode(appearance));
            applyBackground(getActivity(), getBridge().getWebView());
            call.resolve();
        });
    }
}
