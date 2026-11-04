import OverdeckPush
import UserNotifications
import XCTest

final class PushContentTests: XCTestCase {
    private func placeholder() -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = "Overdeck"
        content.body = "Something needs you"
        content.userInfo = ["s": "x", "aps": [String: Any]()]
        return content
    }

    private func payload(title: String) throws -> PhonePushPayload {
        let json = #"{"v":1,"machine":"env-1","kind":"question","title":"\#(title)","body":"Pick one","url":"/m?subject=conv-1","tag":"q:conv-1","issueId":"PAN-1","ts":"2026-11-03T00:00:00.000Z"}"#
        return try JSONDecoder().decode(PhonePushPayload.self, from: Data(json.utf8))
    }

    func testReplacesThePlaceholderWithThePayload() throws {
        let content = placeholder()
        PushContent.apply(try payload(title: "Agent asks: deploy now?"), to: content)
        XCTAssertEqual(content.title, "Agent asks: deploy now?")
        XCTAssertEqual(content.body, "Pick one")
        XCTAssertEqual(content.threadIdentifier, "q:conv-1")
        XCTAssertEqual(content.userInfo["url"] as? String, "/m?subject=conv-1")
        XCTAssertEqual(content.userInfo["machine"] as? String, "env-1")
        XCTAssertEqual(content.userInfo["kind"] as? String, "question")
        XCTAssertEqual(content.userInfo["tag"] as? String, "q:conv-1")
        XCTAssertNil(content.userInfo["s"])
        XCTAssertNotNil(content.userInfo["aps"])
    }

    func testAnEmptyTitleKeepsThePlaceholderTitle() throws {
        let content = placeholder()
        PushContent.apply(try payload(title: "  "), to: content)
        XCTAssertEqual(content.title, "Overdeck")
        XCTAssertEqual(content.body, "Pick one")
    }
}
