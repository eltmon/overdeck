import ActivityKit
import Capacitor
import Foundation

/// The `OverdeckLiveActivity` plugin on iOS (PAN-4839): starts and ends the counts-only Live Activity
/// and reports its APNs activity push token to JavaScript, which registers it with the overdeck.ai
/// directory. The machines' counts then reach the card by APNs push with no app code in between.
/// Never log the token itself.
@objc(OverdeckLiveActivityPlugin)
public class OverdeckLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OverdeckLiveActivityPlugin"
    public let jsName = "OverdeckLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    /// D-11: which APNs host the token belongs to follows the build.
    #if DEBUG
    private static let apsEnvironment = "sandbox"
    #else
    private static let apsEnvironment = "production"
    #endif

    /// One `pushTokenUpdates` loop per activity id; touched on the main actor only.
    private var tokenTasks: [String: Task<Void, Never>] = [:]

    override public func load() {
        #if DEBUG
        startDemoIfAsked()
        #endif
    }

    @objc func status(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["supported": false, "enabled": false])
            return
        }
        call.resolve(["supported": true, "enabled": ActivityAuthorizationInfo().areActivitiesEnabled])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["started": false])
            return
        }
        Task { @MainActor in
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                call.resolve(["started": false])
                return
            }
            let running = Activity<OverdeckActivityAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }
            let kept: Activity<OverdeckActivityAttributes>
            if let first = running.first {
                kept = first
                for extra in running.dropFirst() {
                    self.tokenTasks.removeValue(forKey: extra.id)?.cancel()
                    await extra.end(nil, dismissalPolicy: .immediate)
                }
            } else {
                do {
                    // "–" until the first push arrives (D-4).
                    let content = ActivityContent(state: OverdeckActivityAttributes.ContentState(needsYou: -1, running: -1), staleDate: nil)
                    kept = try Activity.request(attributes: OverdeckActivityAttributes(), content: content, pushType: .token)
                } catch {
                    call.reject("could not start the Live Activity", nil, error)
                    return
                }
            }
            self.observeTokens(of: kept)
            call.resolve(["started": true])
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        Task { @MainActor in
            for task in self.tokenTasks.values { task.cancel() }
            self.tokenTasks.removeAll()
            for activity in Activity<OverdeckActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }

    /// Emits the current token, and every later one, for `activity`; one loop per activity.
    @available(iOS 16.2, *)
    @MainActor
    private func observeTokens(of activity: Activity<OverdeckActivityAttributes>) {
        if let token = activity.pushToken { emit(token) }
        guard tokenTasks[activity.id] == nil else { return }
        let id = activity.id
        tokenTasks[id] = Task { @MainActor [weak self] in
            for await token in activity.pushTokenUpdates {
                self?.emit(token)
            }
            self?.tokenTasks.removeValue(forKey: id)
        }
    }

    private func emit(_ token: Data) {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        print("[OverdeckLiveActivity] token \(hex.count) chars")
        notifyListeners("token", data: ["token": hex, "apsEnvironment": Self.apsEnvironment], retainUntilConsumed: true)
    }

    #if DEBUG
    /// D-15: `-overdeckLiveActivityDemo N,M` starts a local card with those counts (no push), so the
    /// rig can screenshot the widget without sign-in or APNs. Release builds ignore it.
    private func startDemoIfAsked() {
        guard #available(iOS 16.2, *) else { return }
        let arguments = ProcessInfo.processInfo.arguments
        guard let flag = arguments.firstIndex(of: "-overdeckLiveActivityDemo"), flag + 1 < arguments.count else { return }
        let parts = arguments[flag + 1].split(separator: ",").compactMap { Int($0) }
        guard parts.count == 2 else { return }
        Task { @MainActor in
            for activity in Activity<OverdeckActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            let content = ActivityContent(state: OverdeckActivityAttributes.ContentState(needsYou: parts[0], running: parts[1]), staleDate: nil)
            _ = try? Activity.request(attributes: OverdeckActivityAttributes(), content: content, pushType: nil)
            print("[OverdeckLiveActivity] demo card started")
        }
    }
    #endif
}
