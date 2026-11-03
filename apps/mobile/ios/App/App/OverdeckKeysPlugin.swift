import Capacitor
import CryptoKit
import Foundation
import OverdeckPush

/// The `OverdeckKeys` plugin on iOS (PAN-4837 FR-3, C-3, C-5): the install's client id and push key
/// pair, and the named secrets `account` and `machines`, all in the Keychain. The push secret key is
/// stored but never returned to JavaScript. The push key pair lives in the shared access group the
/// NotificationService extension reads; everything else stays in the app's private group (PAN-4838 FR-7).
@objc(OverdeckKeysPlugin)
public class OverdeckKeysPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OverdeckKeysPlugin"
    public let jsName = "OverdeckKeys"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ensureKeys", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSecret", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSecret", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeSecret", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reset", returnType: CAPPluginReturnPromise),
    ]

    private static let clientIdKey = "clientId"
    private static let secretPrefix = "secret."
    private static let secretNames: Set<String> = ["account", "machines"]
    /// The Keychain survives an uninstall; this flag (in UserDefaults, which does not) marks a fresh install.
    private static let initializedFlag = "ai.overdeck.keychainInitialized"

    @objc func ensureKeys(_ call: CAPPluginCall) {
        run(call) {
            let defaults = UserDefaults.standard
            let group = PushKeys.sharedGroup()
            if !defaults.bool(forKey: Self.initializedFlag) {
                try KeychainStore.removeAll(sharedGroup: group)
                defaults.set(true, forKey: Self.initializedFlag)
            }
            var clientId = try KeychainStore.get(Self.clientIdKey)
            var pair = try Self.loadShared(group) ?? PushKeys.load(group: nil)
            if clientId == nil || pair == nil {
                let privateKey = Curve25519.KeyAgreement.PrivateKey()
                let newPair = PushKeyPair(publicKey: Array(privateKey.publicKey.rawRepresentation), secretKey: Array(privateKey.rawRepresentation))
                do {
                    try PushKeys.store(newPair, group: group)
                } catch let failure as KeychainStore.Failure where failure.status == errSecMissingEntitlement {
                    NSLog("[OverdeckKeys] shared keychain group unavailable; notifications will show the placeholder")
                    try PushKeys.store(newPair, group: nil)
                }
                let newClientId = UUID().uuidString.lowercased()
                try KeychainStore.set(Self.clientIdKey, newClientId)
                clientId = newClientId
                pair = newPair
            }
            let publicKeyHex = pair.map { Hex.encode($0.publicKey) } ?? ""
            #if DEBUG
            NSLog("[OverdeckKeys] push public key %@", publicKeyHex)
            #endif
            call.resolve(["clientId": clientId ?? "", "pushPublicKeyHex": publicKeyHex])
        }
    }

    @objc func getSecret(_ call: CAPPluginCall) {
        guard let name = secretName(call) else { return }
        run(call) {
            if let value = try KeychainStore.get(Self.secretPrefix + name) {
                call.resolve(["value": value])
            } else {
                call.resolve(["value": NSNull()])
            }
        }
    }

    @objc func setSecret(_ call: CAPPluginCall) {
        guard let name = secretName(call) else { return }
        guard let value = call.getString("value") else {
            call.reject("value is required")
            return
        }
        run(call) {
            try KeychainStore.set(Self.secretPrefix + name, value)
            call.resolve()
        }
    }

    @objc func removeSecret(_ call: CAPPluginCall) {
        guard let name = secretName(call) else { return }
        run(call) {
            try KeychainStore.remove(Self.secretPrefix + name)
            call.resolve()
        }
    }

    @objc func reset(_ call: CAPPluginCall) {
        run(call) {
            try KeychainStore.removeAll(sharedGroup: PushKeys.sharedGroup())
            call.resolve()
        }
    }

    /// The secret name, or nil after rejecting the call for any name but `account` and `machines`.
    private func secretName(_ call: CAPPluginCall) -> String? {
        guard let name = call.getString("name"), Self.secretNames.contains(name) else {
            call.reject("unknown secret")
            return nil
        }
        return name
    }

    private func run(_ call: CAPPluginCall, _ work: @escaping () throws -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try work()
            } catch let failure as KeychainStore.Failure {
                call.reject("secure storage failed (OSStatus \(failure.status))", nil, failure)
            } catch {
                call.reject("secure storage failed", nil, error)
            }
        }
    }

    /// The push key pair from the shared group, or nil when there is none or this build lacks the
    /// shared-group entitlement (an unsigned Simulator build, D-5), which then reads any group.
    private static func loadShared(_ group: String?) throws -> PushKeyPair? {
        guard let group else { return nil }
        do {
            return try PushKeys.load(group: group)
        } catch let failure as KeychainStore.Failure where failure.status == errSecMissingEntitlement {
            return nil
        }
    }
}
