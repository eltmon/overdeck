import Capacitor
import CryptoKit
import Foundation

/// The `OverdeckKeys` plugin on iOS (PAN-4837 FR-3, C-3, C-5): the install's client id and push key
/// pair, and the named secrets `account` and `machines`, all in the Keychain. The push secret key is
/// stored but never returned to JavaScript.
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
    private static let pushSecretKey = "pushSecretKey"
    private static let pushPublicKey = "pushPublicKey"
    private static let secretPrefix = "secret."
    private static let secretNames: Set<String> = ["account", "machines"]
    /// The Keychain survives an uninstall; this flag (in UserDefaults, which does not) marks a fresh install.
    private static let initializedFlag = "ai.overdeck.keychainInitialized"

    @objc func ensureKeys(_ call: CAPPluginCall) {
        run(call) {
            let defaults = UserDefaults.standard
            if !defaults.bool(forKey: Self.initializedFlag) {
                try KeychainStore.removeAll()
                defaults.set(true, forKey: Self.initializedFlag)
            }
            var clientId = try KeychainStore.get(Self.clientIdKey)
            var publicKeyHex = try KeychainStore.get(Self.pushPublicKey)
            if clientId == nil || publicKeyHex == nil {
                let privateKey = Curve25519.KeyAgreement.PrivateKey()
                let newClientId = UUID().uuidString.lowercased()
                let newPublicKeyHex = Self.hex(privateKey.publicKey.rawRepresentation)
                try KeychainStore.set(Self.pushSecretKey, Self.hex(privateKey.rawRepresentation))
                try KeychainStore.set(Self.pushPublicKey, newPublicKeyHex)
                try KeychainStore.set(Self.clientIdKey, newClientId)
                clientId = newClientId
                publicKeyHex = newPublicKeyHex
            }
            call.resolve(["clientId": clientId ?? "", "pushPublicKeyHex": publicKeyHex ?? ""])
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
            try KeychainStore.removeAll()
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

    private static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}
