package ai.overdeck.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/** Robolectric only for a real org.json; PushNotice has no other Android dependency. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class PushNoticeTest {
    private static final String MACHINE = "e91ffda1-431a-483d-a6e4-a72079516ea4";

    private static JSONObject payload() throws JSONException {
        return new JSONObject()
                .put("v", 1)
                .put("machine", MACHINE)
                .put("kind", "question")
                .put("title", "PAN-4840 asks: Ship the Android handler?")
                .put("body", "Choose one: yes, no, later")
                .put("url", "/m?subject=pan-4840-conv")
                .put("tag", "auq:toolu_fixture")
                .put("issueId", "PAN-4840")
                .put("ts", "2026-11-03T20:00:00.000Z");
    }

    @Test
    public void mapsAValidPayloadToItsNotice() throws JSONException {
        PushNotice n = PushNotice.parse(payload().toString());
        assertEquals("PAN-4840 asks: Ship the Android handler?", n.title);
        assertEquals("Choose one: yes, no, later", n.body);
        assertEquals(PushNotice.CHANNEL_NEEDS_YOU, n.channelId);
        assertEquals(MACHINE + ":auq:toolu_fixture", n.notificationTag);
        assertEquals(PushNotice.openLink(MACHINE, "/m?subject=pan-4840-conv", "2026-11-03T20:00:00.000Z"), n.openLink);
    }

    @Test
    public void mapsEachKindToItsChannel() throws JSONException {
        for (String kind : new String[] { "question", "approval", "failed" }) {
            assertEquals(kind, PushNotice.CHANNEL_NEEDS_YOU, PushNotice.parse(payload().put("kind", kind).toString()).channelId);
        }
        for (String kind : new String[] { "finished", "summary", "test" }) {
            assertEquals(kind, PushNotice.CHANNEL_UPDATES, PushNotice.parse(payload().put("kind", kind).toString()).channelId);
        }
    }

    @Test
    public void rejectsInvalidPayloads() throws JSONException {
        assertNull(PushNotice.parse(payload().put("v", 2).toString()));
        assertNull(PushNotice.parse(payload().put("machine", "not-a-uuid").toString()));
        assertNull(PushNotice.parse(payload().put("kind", "party").toString()));
        assertNull(PushNotice.parse(payload().put("tag", "").toString()));
        assertNull(PushNotice.parse(payload().put("url", "https://evil.example/m").toString()));
        assertNull(PushNotice.parse(payload().put("title", 7).toString()));
        assertNull(PushNotice.parse("not json"));
    }

    @Test
    public void buildsTheExactOpenLink() {
        assertEquals(
                "ai.overdeck.app:/open#v=1&e=e91ffda1-431a-483d-a6e4-a72079516ea4&p=%2Fm%3Fsubject%3Da+b%26x%3D1&t=2026-11-03T20%3A00%3A00.000Z",
                PushNotice.openLink(MACHINE, "/m?subject=a b&x=1", "2026-11-03T20:00:00.000Z"));
    }

    @Test
    public void placeholderFollowsThePushPriority() {
        PushNotice high = PushNotice.placeholder(true);
        assertEquals(PushNotice.PLACEHOLDER_TITLE, high.title);
        assertEquals(PushNotice.PLACEHOLDER_BODY, high.body);
        assertEquals(PushNotice.CHANNEL_NEEDS_YOU, high.channelId);
        assertEquals(PushNotice.PLACEHOLDER_TAG, high.notificationTag);
        assertNull(high.openLink);
        assertEquals(PushNotice.CHANNEL_UPDATES, PushNotice.placeholder(false).channelId);
    }
}
