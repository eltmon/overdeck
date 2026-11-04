package ai.overdeck.app;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.util.regex.Pattern;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * What one phone push shows (PAN-4840 FR-3, FR-4, FR-6): parsed from a `PhonePushPayload`
 * (`packages/contracts/src/connect.ts`), or the placeholder when the push cannot be opened.
 */
final class PushNotice {
    static final String CHANNEL_NEEDS_YOU = "needs-you";
    static final String CHANNEL_UPDATES = "updates";
    static final String PLACEHOLDER_TITLE = "Overdeck";
    static final String PLACEHOLDER_BODY = "Something needs you";
    static final String PLACEHOLDER_TAG = "overdeck:placeholder";
    static final String OPEN_LINK_PREFIX = "ai.overdeck.app:/open#";

    private static final Pattern MACHINE_ID =
            Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");

    final String title;
    final String body;
    final String channelId;
    final String notificationTag;
    /** Null for the placeholder, whose tap opens the app with no route. */
    final String openLink;

    private PushNotice(String title, String body, String channelId, String notificationTag, String openLink) {
        this.title = title;
        this.body = body;
        this.channelId = channelId;
        this.notificationTag = notificationTag;
        this.openLink = openLink;
    }

    /** The notice for a decrypted payload, or null when it is not a valid version-1 payload. */
    static PushNotice parse(String json) {
        try {
            JSONObject p = new JSONObject(json);
            if (!Integer.valueOf(1).equals(p.opt("v"))) return null;
            String machine = p.optString("machine", "");
            if (!MACHINE_ID.matcher(machine).matches()) return null;
            String channel = channelFor(p.optString("kind", ""));
            if (channel == null) return null;
            String title = stringField(p, "title");
            String body = stringField(p, "body");
            String url = stringField(p, "url");
            String tag = stringField(p, "tag");
            String ts = stringField(p, "ts");
            if (title == null || body == null || url == null || tag == null || ts == null) return null;
            if (tag.isEmpty() || !url.startsWith("/m")) return null;
            return new PushNotice(title, body, channel, machine + ":" + tag, openLink(machine, url, ts));
        } catch (JSONException e) {
            return null;
        }
    }

    /** `ai.overdeck.app:/open#v=1&e=<machine>&p=<path>&t=<ts>`, the link a tap hands to the shell. */
    static String openLink(String machine, String path, String ts) {
        return OPEN_LINK_PREFIX + "v=1&e=" + machine + "&p=" + enc(path) + "&t=" + enc(ts);
    }

    static PushNotice placeholder(boolean highPriority) {
        return new PushNotice(PLACEHOLDER_TITLE, PLACEHOLDER_BODY,
                highPriority ? CHANNEL_NEEDS_YOU : CHANNEL_UPDATES, PLACEHOLDER_TAG, null);
    }

    /** `needs-you` for the kinds that wait on the operator (the `webPushUrgency` rule), else `updates`. */
    private static String channelFor(String kind) {
        switch (kind) {
            case "question":
            case "approval":
            case "failed":
                return CHANNEL_NEEDS_YOU;
            case "finished":
            case "summary":
            case "test":
                return CHANNEL_UPDATES;
            default:
                return null;
        }
    }

    private static String stringField(JSONObject p, String name) {
        Object value = p.opt(name);
        return value instanceof String ? (String) value : null;
    }

    // The String overload: URLEncoder.encode(String, Charset) needs API 33 (NFR-3).
    private static String enc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            throw new AssertionError(e);
        }
    }
}
