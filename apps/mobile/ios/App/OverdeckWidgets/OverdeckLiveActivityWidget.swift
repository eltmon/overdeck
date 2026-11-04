import ActivityKit
import SwiftUI
import WidgetKit

/// The counts-only Live Activity (PAN-4839, FR-1, OD-1): how many items need the operator and how many
/// agents are running. APNs updates it with no app code in between, so it shows these two numbers only.
/// A stale card (no update for 10 minutes) draws at half opacity (D-14).
@available(iOS 16.2, *)
struct OverdeckLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: OverdeckActivityAttributes.self) { context in
            LockScreenView(state: context.state)
                .opacity(context.isStale ? 0.5 : 1)
                .padding(16)
        } dynamicIsland: { context in
            let state = context.state
            let dim = context.isStale ? 0.5 : 1.0
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(OverdeckActivityText.needsYou(state.needsYou), systemImage: "bell.fill")
                        .font(.subheadline)
                        .opacity(dim)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Label(OverdeckActivityText.running(state.running), systemImage: "play.fill")
                        .font(.subheadline)
                        .opacity(dim)
                }
            } compactLeading: {
                Label(OverdeckActivityText.count(state.needsYou), systemImage: "bell.fill")
                    .opacity(dim)
            } compactTrailing: {
                Label(OverdeckActivityText.count(state.running), systemImage: "play.fill")
                    .opacity(dim)
            } minimal: {
                Text(OverdeckActivityText.count(state.needsYou))
                    .opacity(dim)
            }
        }
    }
}

@available(iOS 16.2, *)
private struct LockScreenView: View {
    let state: OverdeckActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 8) {
            Text("Overdeck")
                .font(.headline)
            Spacer()
            Text("\(OverdeckActivityText.needsYou(state.needsYou)) · \(OverdeckActivityText.running(state.running))")
                .font(.subheadline.monospacedDigit())
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(OverdeckActivityText.accessibility(needsYou: state.needsYou, running: state.running))
    }
}
