import UserNotifications

/// Turns the directory's placeholder notification into the decrypted one (PAN-4838 FR-5).
public enum PushContent {
    /// Rewrites the placeholder with the decrypted payload (FR-5). An empty title keeps the placeholder title.
    public static func apply(_ payload: PhonePushPayload, to content: UNMutableNotificationContent) {
        if !payload.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { content.title = payload.title }
        content.body = payload.body
        content.threadIdentifier = payload.tag
        var info = content.userInfo
        info.removeValue(forKey: "s")
        info["url"] = payload.url
        info["machine"] = payload.machine
        info["kind"] = payload.kind
        info["tag"] = payload.tag
        content.userInfo = info
    }
}
