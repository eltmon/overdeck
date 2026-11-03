package ai.overdeck.app;

import android.content.Context;
import android.util.Base64;

import com.goterl.lazysodium.interfaces.Box;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;

/**
 * Turns one sealed phone push into a notification (PAN-4840 FR-2, FR-5): open it with the push
 * key pair, parse it, post it. A push that arrives for this phone but cannot be opened posts the
 * placeholder; a push that arrives after sign-out posts nothing.
 */
final class PushHandler {
    /** What one push did (PAN-4840 FR-5). Logged by name only, never with content (NFR-1). */
    enum Outcome { POSTED, PLACEHOLDER, NO_PAYLOAD, SIGNED_OUT, NOTIFICATIONS_OFF }

    /** The install's push key pair; null when signed out. */
    interface KeySource {
        PushKeys read() throws GeneralSecurityException;
    }

    static final class PushKeys {
        final byte[] publicKey;
        final byte[] secretKey;

        PushKeys(byte[] publicKey, byte[] secretKey) {
            this.publicKey = publicKey;
            this.secretKey = secretKey;
        }
    }

    private PushHandler() {}

    static Outcome handle(Context ctx, String sealedBase64, boolean highPriority, KeySource keys, Box.Native sodium) {
        if (sealedBase64 == null) return Outcome.NO_PAYLOAD;
        PushKeys pair;
        try {
            pair = keys.read();
        } catch (GeneralSecurityException e) {
            return post(ctx, PushNotice.placeholder(highPriority), Outcome.PLACEHOLDER);
        }
        if (pair == null) return Outcome.SIGNED_OUT;
        PushNotice notice = open(sealedBase64, pair, sodium);
        if (notice == null) return post(ctx, PushNotice.placeholder(highPriority), Outcome.PLACEHOLDER);
        return post(ctx, notice, Outcome.POSTED);
    }

    private static PushNotice open(String sealedBase64, PushKeys pair, Box.Native sodium) {
        byte[] sealed;
        try {
            sealed = Base64.decode(sealedBase64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            return null;
        }
        byte[] plain = SealedBox.open(sodium, sealed, pair.publicKey, pair.secretKey);
        return plain == null ? null : PushNotice.parse(new String(plain, StandardCharsets.UTF_8));
    }

    private static Outcome post(Context ctx, PushNotice notice, Outcome whenPosted) {
        return PushNotifier.post(ctx, notice) ? whenPosted : Outcome.NOTIFICATIONS_OFF;
    }
}
