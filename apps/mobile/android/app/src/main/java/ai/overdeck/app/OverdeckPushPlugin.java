package ai.overdeck.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;

/** PAN-4840 D-5: whether this build has a Firebase config, so JS never calls a register() that would crash. */
@CapacitorPlugin(name = "OverdeckPush")
public class OverdeckPushPlugin extends Plugin {
    @Override
    public void load() {
        // Creates the channels on first launch so they show in Android Settings before any push.
        PushNotifier.ensureChannels(getContext());
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("configured", !FirebaseApp.getApps(getContext()).isEmpty());
        call.resolve(result);
    }
}
