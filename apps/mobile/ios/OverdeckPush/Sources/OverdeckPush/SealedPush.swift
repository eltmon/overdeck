import Foundation
import Sodium

/// The plaintext a machine seals into a `push` frame (packages/contracts/src/connect.ts `PhonePushPayload`).
public struct PhonePushPayload: Decodable, Equatable {
    public let v: Int
    public let machine: String
    public let kind: String
    public let title: String
    public let body: String
    public let url: String
    public let tag: String
    public let issueId: String?
    public let ts: String
}

/// The install's X25519 push key pair, raw 32-byte halves (a CryptoKit raw key is a libsodium key).
public struct PushKeyPair: Equatable {
    public let publicKey: [UInt8]
    public let secretKey: [UInt8]

    public init(publicKey: [UInt8], secretKey: [UInt8]) {
        self.publicKey = publicKey
        self.secretKey = secretKey
    }
}

/// Opens the directory's `s` field: libsodium `crypto_box_seal` of the payload, base64 (PAN-4838 FR-5, FR-6).
public enum SealedPush {
    /// The payload, or nil when `sealed` is not base64, does not open with `keys`, or is not a v1 payload.
    public static func open(_ sealed: String, keys: PushKeyPair) -> PhonePushPayload? {
        guard keys.publicKey.count == 32, keys.secretKey.count == 32,
              let data = Data(base64Encoded: sealed),
              let plain = Sodium().box.open(anonymousCipherText: Array(data), recipientPublicKey: keys.publicKey, recipientSecretKey: keys.secretKey),
              let payload = try? JSONDecoder().decode(PhonePushPayload.self, from: Data(plain)),
              payload.v == 1
        else { return nil }
        return payload
    }
}
