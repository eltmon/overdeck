package ai.overdeck.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.robolectric.Shadows.shadowOf;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.util.Base64;

import com.goterl.lazysodium.interfaces.Box;

import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;

import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowNotificationManager;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class PushHandlerTest {
    private static final String MACHINE = "e91ffda1-431a-483d-a6e4-a72079516ea4";
    private static final PushHandler.KeySource KEYS = () -> new PushHandler.PushKeys(new byte[32], new byte[32]);
    // Any base64 at least SEALBYTES long; the stub opener ignores its content.
    private static final String SEALED = Base64.encodeToString(new byte[Box.SEALBYTES + 8], Base64.NO_WRAP);

    private Context ctx;
    private ShadowNotificationManager notifications;

    @Before
    public void setUp() {
        ctx = RuntimeEnvironment.getApplication();
        notifications = shadowOf((NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE));
    }

    /** A `Box.Native` whose `cryptoBoxSealOpen` yields `plain`, or fails when `plain` is null. */
    private static Box.Native opener(String plain) {
        return (Box.Native) Proxy.newProxyInstance(Box.Native.class.getClassLoader(), new Class<?>[] { Box.Native.class },
                (proxy, method, args) -> {
                    if (!method.getName().equals("cryptoBoxSealOpen")) throw new UnsupportedOperationException(method.getName());
                    if (plain == null) return false;
                    byte[] bytes = plain.getBytes(StandardCharsets.UTF_8);
                    byte[] out = (byte[]) args[0];
                    System.arraycopy(bytes, 0, out, 0, Math.min(bytes.length, out.length));
                    return true;
                });
    }

    private static String payload(String kind, String title, String tag) throws JSONException {
        return new JSONObject()
                .put("v", 1)
                .put("machine", MACHINE)
                .put("kind", kind)
                .put("title", title)
                .put("body", "Choose one: yes, no, later")
                .put("url", "/m?subject=pan-4840-conv")
                .put("tag", tag)
                .put("ts", "2026-11-03T20:00:00.000Z")
                .toString();
    }

    /** Handles a push whose box opens to `plain` (null: does not open), sized so the plaintext fills it. */
    private PushHandler.Outcome handle(String plain, boolean highPriority) {
        byte[] bytes = plain == null ? new byte[8] : plain.getBytes(StandardCharsets.UTF_8);
        String sealed = Base64.encodeToString(new byte[Box.SEALBYTES + bytes.length], Base64.NO_WRAP);
        return PushHandler.handle(ctx, sealed, highPriority, KEYS, opener(plain));
    }

    @Test
    public void postsAValidPushOnItsChannel() throws JSONException {
        assertEquals(PushHandler.Outcome.POSTED, handle(payload("question", "Ship it?", "auq:1"), true));
        Notification n = notifications.getNotification(MACHINE + ":auq:1", 1);
        assertNotNull(n);
        assertEquals("Ship it?", n.extras.getCharSequence(Notification.EXTRA_TITLE).toString());
        assertEquals("Choose one: yes, no, later", n.extras.getCharSequence(Notification.EXTRA_TEXT).toString());
        assertEquals(PushNotice.CHANNEL_NEEDS_YOU, n.getChannelId());
    }

    @Test
    public void postsAFinishedPushOnUpdates() throws JSONException {
        assertEquals(PushHandler.Outcome.POSTED, handle(payload("finished", "Done", "fin:1"), false));
        assertEquals(PushNotice.CHANNEL_UPDATES, notifications.getNotification(MACHINE + ":fin:1", 1).getChannelId());
    }

    @Test
    public void aNewerPushReplacesTheOlderOneWithTheSameTag() throws JSONException {
        handle(payload("question", "First", "auq:1"), true);
        handle(payload("question", "Second", "auq:1"), true);
        assertEquals(1, notifications.getAllNotifications().size());
        assertEquals("Second",
                notifications.getNotification(MACHINE + ":auq:1", 1).extras.getCharSequence(Notification.EXTRA_TITLE).toString());
    }

    @Test
    public void aBoxThatDoesNotOpenPostsThePlaceholderByPriority() {
        assertEquals(PushHandler.Outcome.PLACEHOLDER, handle(null, true));
        Notification high = notifications.getNotification(PushNotice.PLACEHOLDER_TAG, 1);
        assertEquals(PushNotice.PLACEHOLDER_TITLE, high.extras.getCharSequence(Notification.EXTRA_TITLE).toString());
        assertEquals(PushNotice.PLACEHOLDER_BODY, high.extras.getCharSequence(Notification.EXTRA_TEXT).toString());
        assertEquals(PushNotice.CHANNEL_NEEDS_YOU, high.getChannelId());
        assertNull(shadowOf(high.contentIntent).getSavedIntent().getData());

        assertEquals(PushHandler.Outcome.PLACEHOLDER, handle(null, false));
        assertEquals(PushNotice.CHANNEL_UPDATES, notifications.getNotification(PushNotice.PLACEHOLDER_TAG, 1).getChannelId());
    }

    @Test
    public void anInvalidPayloadPostsThePlaceholder() {
        assertEquals(PushHandler.Outcome.PLACEHOLDER, handle("{\"v\":2}", true));
        assertNotNull(notifications.getNotification(PushNotice.PLACEHOLDER_TAG, 1));
    }

    @Test
    public void malformedBase64PostsThePlaceholder() {
        assertEquals(PushHandler.Outcome.PLACEHOLDER, PushHandler.handle(ctx, "%%%", true, KEYS, opener(null)));
        assertNotNull(notifications.getNotification(PushNotice.PLACEHOLDER_TAG, 1));
    }

    @Test
    public void aKeyStoreFailurePostsThePlaceholder() {
        PushHandler.KeySource broken = () -> { throw new java.security.GeneralSecurityException("keystore"); };
        assertEquals(PushHandler.Outcome.PLACEHOLDER, PushHandler.handle(ctx, SEALED, true, broken, opener(null)));
        assertNotNull(notifications.getNotification(PushNotice.PLACEHOLDER_TAG, 1));
    }

    @Test
    public void signedOutPostsNothing() throws JSONException {
        PushHandler.Outcome outcome = PushHandler.handle(ctx, SEALED, true, () -> null, opener(payload("question", "x", "auq:1")));
        assertEquals(PushHandler.Outcome.SIGNED_OUT, outcome);
        assertEquals(0, notifications.getAllNotifications().size());
    }

    @Test
    public void noPayloadPostsNothing() {
        assertEquals(PushHandler.Outcome.NO_PAYLOAD, PushHandler.handle(ctx, null, true, KEYS, opener(null)));
        assertEquals(0, notifications.getAllNotifications().size());
    }

    @Test
    public void notificationsOffPostsNothing() throws JSONException {
        notifications.setNotificationsEnabled(false);
        assertEquals(PushHandler.Outcome.NOTIFICATIONS_OFF, handle(payload("question", "x", "auq:1"), true));
        assertEquals(0, notifications.getAllNotifications().size());
    }

    @Test
    public void theTapOpensTheOpenLinkInMainActivity() throws JSONException {
        handle(payload("question", "Ship it?", "auq:1"), true);
        Intent saved = shadowOf(notifications.getNotification(MACHINE + ":auq:1", 1).contentIntent).getSavedIntent();
        assertEquals(PushNotice.openLink(MACHINE, "/m?subject=pan-4840-conv", "2026-11-03T20:00:00.000Z"),
                saved.getData().toString());
        assertEquals(MainActivity.class.getName(), saved.getComponent().getClassName());
    }
}
