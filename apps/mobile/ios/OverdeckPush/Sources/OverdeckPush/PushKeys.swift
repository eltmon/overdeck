import Foundation

/// The install's push key pair in the Keychain, as hex in two items (PAN-4838 FR-7, D-3 to D-6).
/// The app writes it; the NotificationService extension reads it from the shared access group.
public enum PushKeys {
    public static let secretAccount = "pushSecretKey"
    public static let publicAccount = "pushPublicKey"
    public static let groupInfoKey = "OverdeckSharedKeychainGroup"

    /// The expanded shared access group from Info.plist, or nil when absent or empty.
    public static func sharedGroup(_ bundle: Bundle = .main) -> String? {
        guard let value = bundle.object(forInfoDictionaryKey: groupInfoKey) as? String else { return nil }
        let group = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return group.isEmpty ? nil : group
    }

    /// Both halves from `group` (nil: any group), or nil when either item is missing or not 32 bytes of hex.
    public static func load(group: String?) throws -> PushKeyPair? {
        guard let secretHex = try KeychainStore.get(secretAccount, group: group),
              let publicHex = try KeychainStore.get(publicAccount, group: group),
              let secretKey = Hex.decode(secretHex), secretKey.count == 32,
              let publicKey = Hex.decode(publicHex), publicKey.count == 32
        else { return nil }
        return PushKeyPair(publicKey: publicKey, secretKey: secretKey)
    }

    /// Writes both halves to `group`.
    public static func store(_ pair: PushKeyPair, group: String?) throws {
        try KeychainStore.set(secretAccount, Hex.encode(pair.secretKey), group: group)
        try KeychainStore.set(publicAccount, Hex.encode(pair.publicKey), group: group)
    }
}
