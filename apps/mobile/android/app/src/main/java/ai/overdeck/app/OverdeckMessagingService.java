package ai.overdeck.app;

import android.util.Log;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import com.goterl.lazysodium.LazySodiumAndroid;
import com.goterl.lazysodium.SodiumAndroid;

import java.security.GeneralSecurityException;

/** PAN-4840 FR-1: opens each sealed data push with the install's push key and posts it, also when the app is closed. */
public class OverdeckMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        SecureStore store = new SecureStore(this);
        PushHandler.Outcome outcome = PushHandler.handle(
                this,
                message.getData().get("s"),
                message.getOriginalPriority() == RemoteMessage.PRIORITY_HIGH,
                () -> {
                    String pk = store.get(OverdeckKeysPlugin.PUSH_PUBLIC_KEY);
                    String sk = store.get(OverdeckKeysPlugin.PUSH_SECRET_KEY);
                    if (pk == null || sk == null) return null;
                    try {
                        return new PushHandler.PushKeys(Hex.decode(pk), Hex.decode(sk));
                    } catch (IllegalArgumentException e) {
                        throw new GeneralSecurityException("stored push key is not hex", e);
                    }
                },
                new LazySodiumAndroid(new SodiumAndroid()));
        // The outcome name only: never the payload, token or keys (NFR-1).
        Log.i("OverdeckPush", outcome.name());
    }

    @Override
    public void onNewToken(@NonNull String token) {
        PushNotificationsPlugin.onNewToken(token);
    }
}
