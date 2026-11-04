import Foundation
import Security

/// Generic-password Keychain items under service `ai.overdeck.app` (PAN-4837 FR-3, C-5): readable
/// after first unlock, this device only, never synchronized. With no `group` an item lands in the
/// binary's default (first listed) access group; the push key names the shared group (PAN-4838 D-2, D-4).
public enum KeychainStore {
    private static let service = "ai.overdeck.app"

    public struct Failure: Error {
        public let status: OSStatus
    }

    private static func query(_ account: String, group: String?) -> [String: Any] {
        var item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
        if let group { item[kSecAttrAccessGroup as String] = group }
        return item
    }

    public static func get(_ account: String, group: String? = nil) throws -> String? {
        var item = query(account, group: group)
        item[kSecReturnData as String] = kCFBooleanTrue
        item[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(item as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw Failure(status: status) }
        return String(data: data, encoding: .utf8)
    }

    public static func set(_ account: String, _ value: String, group: String? = nil) throws {
        try remove(account, group: group)
        var item = query(account, group: group)
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw Failure(status: status) }
    }

    public static func remove(_ account: String, group: String? = nil) throws {
        let status = SecItemDelete(query(account, group: group) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure(status: status) }
    }

    /// Deletes every item this app stored under the service: first in every group the binary can
    /// read, then in `sharedGroup`. A build without the shared-group entitlement holds nothing
    /// there, so `errSecMissingEntitlement` on that second delete is not a failure (D-5).
    public static func removeAll(sharedGroup: String?) throws {
        var item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        var status = SecItemDelete(item as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure(status: status) }
        guard let sharedGroup else { return }
        item[kSecAttrAccessGroup as String] = sharedGroup
        status = SecItemDelete(item as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound || status == errSecMissingEntitlement else {
            throw Failure(status: status)
        }
    }
}
