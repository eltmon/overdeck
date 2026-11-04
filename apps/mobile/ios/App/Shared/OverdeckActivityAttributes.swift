import ActivityKit

/// The Live Activity's only data (PAN-4839, OD-1). No static attributes: nothing else reaches the card.
@available(iOS 16.1, *)
public struct OverdeckActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var needsYou: Int
        public var running: Int

        public init(needsYou: Int, running: Int) {
            self.needsYou = needsYou
            self.running = running
        }
    }

    public init() {}
}

/// "–" before the first update (negative), "1 needs you", "N need you".
public enum OverdeckActivityText {
    public static func count(_ n: Int) -> String { n < 0 ? "–" : String(n) }
    public static func needsYou(_ n: Int) -> String { n == 1 ? "1 needs you" : "\(count(n)) need you" }
    public static func running(_ n: Int) -> String { "\(count(n)) running" }
    /// The VoiceOver label: "N need you, M running".
    public static func accessibility(needsYou: Int, running: Int) -> String { "\(Self.needsYou(needsYou)), \(Self.running(running))" }
}
