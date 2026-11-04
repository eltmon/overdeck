import OverdeckPush
import UserNotifications

/// Opens the sealed needs-you payload and shows its real title and body (PAN-4838 FR-5). On any
/// failure, or when time runs out, the directory's placeholder shows unchanged (FR-6).
final class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttempt: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content)
            return
        }
        self.contentHandler = contentHandler
        bestAttempt = content
        if let sealed = content.userInfo["s"] as? String,
           let group = PushKeys.sharedGroup(),
           let keys = try? PushKeys.load(group: group),
           let payload = SealedPush.open(sealed, keys: keys) {
            PushContent.apply(payload, to: content)
        }
        contentHandler(content)
        self.contentHandler = nil
    }

    override func serviceExtensionTimeWillExpire() {
        if let handler = contentHandler, let content = bestAttempt { handler(content) }
        contentHandler = nil
    }
}
