import CryptoKit
import Foundation
import OverdeckPush
import Sodium
import XCTest

/// tests/fixtures/phone-push/sealed-push.json, sealed by sodium-native on the machine side (PAN-4838 NFR-1).
private struct SealedPushFixture: Decodable {
    struct Case: Decodable {
        let name: String
        let payload: PhonePushPayload
        let sealed: String
    }

    struct WrongKey: Decodable {
        let sealed: String
    }

    let publicKeyHex: String
    let secretKeyHex: String
    let cases: [Case]
    let wrongKey: WrongKey
}

final class SealedPushTests: XCTestCase {
    private func loadFixture() throws -> SealedPushFixture {
        // file → OverdeckPushTests → Tests → OverdeckPush → ios → mobile → apps → repo root
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<7 { root = root.deletingLastPathComponent() }
        let url = root.appendingPathComponent("tests/fixtures/phone-push/sealed-push.json")
        guard FileManager.default.fileExists(atPath: url.path) else {
            XCTFail("missing fixture \(url.path): copy tests/fixtures/phone-push beside apps/mobile")
            throw CocoaError(.fileNoSuchFile)
        }
        return try JSONDecoder().decode(SealedPushFixture.self, from: Data(contentsOf: url))
    }

    private func keys(_ fixture: SealedPushFixture) throws -> PushKeyPair {
        let publicKey = try XCTUnwrap(Hex.decode(fixture.publicKeyHex))
        let secretKey = try XCTUnwrap(Hex.decode(fixture.secretKeyHex))
        return PushKeyPair(publicKey: publicKey, secretKey: secretKey)
    }

    func testOpensEveryFixtureCase() throws {
        let fixture = try loadFixture()
        let pair = try keys(fixture)
        XCTAssertEqual(fixture.cases.map(\.name), ["question", "unicode"])
        for item in fixture.cases {
            XCTAssertEqual(SealedPush.open(item.sealed, keys: pair), item.payload, item.name)
        }
        let unicode = try XCTUnwrap(fixture.cases.first { $0.name == "unicode" })
        XCTAssertEqual(SealedPush.open(unicode.sealed, keys: pair)?.title, "Überprüfung ✅ 完了")
    }

    func testRejectsAnotherKeyTamperingBadBase64AndShortKeys() throws {
        let fixture = try loadFixture()
        let pair = try keys(fixture)
        XCTAssertNil(SealedPush.open(fixture.wrongKey.sealed, keys: pair))

        var chars = Array(try XCTUnwrap(fixture.cases.first).sealed)
        let index = chars.count / 2
        chars[index] = chars[index] == "A" ? "B" : "A"
        XCTAssertNil(SealedPush.open(String(chars), keys: pair))

        XCTAssertNil(SealedPush.open("not base64", keys: pair))

        let short = PushKeyPair(publicKey: Array(pair.publicKey.prefix(31)), secretKey: pair.secretKey)
        XCTAssertNil(SealedPush.open(try XCTUnwrap(fixture.cases.first).sealed, keys: short))
    }

    func testOpensABoxSealedToACryptoKitKey() throws {
        let privateKey = Curve25519.KeyAgreement.PrivateKey()
        let pair = PushKeyPair(publicKey: Array(privateKey.publicKey.rawRepresentation), secretKey: Array(privateKey.rawRepresentation))
        let json = #"{"v":1,"machine":"env-ck","kind":"test","title":"CryptoKit","body":"opens","url":"/m","tag":"t","issueId":null,"ts":"2026-11-03T00:00:00.000Z"}"#
        let sealed = try XCTUnwrap(Sodium().box.seal(message: Array(json.utf8), recipientPublicKey: pair.publicKey))
        let payload = try XCTUnwrap(SealedPush.open(Data(sealed).base64EncodedString(), keys: pair))
        XCTAssertEqual(payload.machine, "env-ck")
        XCTAssertEqual(payload.title, "CryptoKit")
        XCTAssertNil(payload.issueId)
    }

    func testRejectsAPayloadThatIsNotVersionOne() throws {
        let privateKey = Curve25519.KeyAgreement.PrivateKey()
        let pair = PushKeyPair(publicKey: Array(privateKey.publicKey.rawRepresentation), secretKey: Array(privateKey.rawRepresentation))
        let json = #"{"v":2,"machine":"m","kind":"test","title":"t","body":"b","url":"/m","tag":"t","issueId":null,"ts":"x"}"#
        let sealed = try XCTUnwrap(Sodium().box.seal(message: Array(json.utf8), recipientPublicKey: pair.publicKey))
        XCTAssertNil(SealedPush.open(Data(sealed).base64EncodedString(), keys: pair))
    }

    func testHexRoundTripsAndRejectsBadInput() {
        XCTAssertEqual(Hex.encode([0x00, 0x2a, 0xff]), "002aff")
        XCTAssertEqual(Hex.decode("002AFF"), [0x00, 0x2a, 0xff])
        XCTAssertNil(Hex.decode("abc"))
        XCTAssertNil(Hex.decode("zz"))
    }
}
