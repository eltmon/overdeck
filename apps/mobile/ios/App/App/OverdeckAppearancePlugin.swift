import Capacitor
import UIKit

/// The `OverdeckAppearance` plugin on iOS (PAN-5041): stores the phone app's appearance and applies it to the
/// window, so `systemBackground` behind the WebView and the default status bar follow it.
@objc(OverdeckAppearancePlugin)
public class OverdeckAppearancePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OverdeckAppearancePlugin"
    public let jsName = "OverdeckAppearance"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise)]

    static let defaultsKey = "overdeck.appearance"

    /// `system` (or anything unknown) ⇒ `.unspecified`.
    static func style(for appearance: String?) -> UIUserInterfaceStyle {
        switch appearance { case "light": return .light; case "dark": return .dark; default: return .unspecified }
    }

    static func storedStyle() -> UIUserInterfaceStyle { style(for: UserDefaults.standard.string(forKey: defaultsKey)) }

    @objc func set(_ call: CAPPluginCall) {
        let appearance = call.getString("appearance") ?? "system"
        UserDefaults.standard.set(appearance, forKey: Self.defaultsKey)
        DispatchQueue.main.async {
            self.bridge?.viewController?.view.window?.overrideUserInterfaceStyle = Self.style(for: appearance)
            self.bridge?.viewController?.setNeedsStatusBarAppearanceUpdate()
            call.resolve()
        }
    }
}
