package ai.overdeck.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.goterl.lazysodium.LazySodiumAndroid;
import com.goterl.lazysodium.SodiumAndroid;
import com.goterl.lazysodium.interfaces.Box;

import java.util.Locale;
import java.util.UUID;

/**
 * The `OverdeckKeys` plugin on Android (PAN-4837 FR-3, C-3, C-4): the install's client id and push
 * key pair, and the named secrets `account` and `machines`, all in {@link SecureStore}. The push
 * secret key is stored but never returned to JavaScript.
 */
@CapacitorPlugin(name = "OverdeckKeys")
public class OverdeckKeysPlugin extends Plugin {
    private static final String CLIENT_ID = "clientId";
    // Package-private: OverdeckMessagingService reads the same key pair (PAN-4840).
    static final String PUSH_SECRET_KEY = "pushSecretKey";
    static final String PUSH_PUBLIC_KEY = "pushPublicKey";
    private static final String SECRET_PREFIX = "secret.";

    private SecureStore store;

    @Override
    public void load() {
        store = new SecureStore(getContext());
    }

    @PluginMethod
    public void ensureKeys(PluginCall call) {
        run(call, () -> {
            String clientId = store.get(CLIENT_ID);
            String pushPublicKey = store.get(PUSH_PUBLIC_KEY);
            if (clientId == null || pushPublicKey == null) {
                byte[] publicKey = new byte[Box.PUBLICKEYBYTES];
                byte[] secretKey = new byte[Box.SECRETKEYBYTES];
                if (!new LazySodiumAndroid(new SodiumAndroid()).cryptoBoxKeypair(publicKey, secretKey)) {
                    call.reject("could not generate the push key pair");
                    return;
                }
                clientId = UUID.randomUUID().toString().toLowerCase(Locale.ROOT);
                pushPublicKey = Hex.encode(publicKey);
                store.put(PUSH_SECRET_KEY, Hex.encode(secretKey));
                store.put(PUSH_PUBLIC_KEY, pushPublicKey);
                store.put(CLIENT_ID, clientId);
            }
            JSObject result = new JSObject();
            result.put("clientId", clientId);
            result.put("pushPublicKeyHex", pushPublicKey);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void getSecret(PluginCall call) {
        String name = secretName(call);
        if (name == null) return;
        run(call, () -> {
            JSObject result = new JSObject();
            String value = store.get(SECRET_PREFIX + name);
            result.put("value", value == null ? JSObject.NULL : value);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void setSecret(PluginCall call) {
        String name = secretName(call);
        if (name == null) return;
        String value = call.getString("value");
        if (value == null) {
            call.reject("value is required");
            return;
        }
        run(call, () -> {
            store.put(SECRET_PREFIX + name, value);
            call.resolve();
        });
    }

    @PluginMethod
    public void removeSecret(PluginCall call) {
        String name = secretName(call);
        if (name == null) return;
        run(call, () -> {
            store.remove(SECRET_PREFIX + name);
            call.resolve();
        });
    }

    @PluginMethod
    public void reset(PluginCall call) {
        run(call, () -> {
            store.clear();
            call.resolve();
        });
    }

    /** The secret name, or null after rejecting the call for any name but `account` and `machines`. */
    private static String secretName(PluginCall call) {
        String name = call.getString("name");
        if ("account".equals(name) || "machines".equals(name)) return name;
        call.reject("unknown secret");
        return null;
    }

    private interface Work {
        void run() throws Exception;
    }

    /** Runs storage work on the bridge's background thread, never the UI thread. */
    private void run(PluginCall call, Work work) {
        getBridge().execute(() -> {
            try {
                work.run();
            } catch (Exception e) {
                call.reject("secure storage failed", e);
            }
        });
    }
}
