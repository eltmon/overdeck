import SwiftUI
import WidgetKit

/// The widget extension's entry point (PAN-4839): the Live Activity is its only widget.
@main
struct OverdeckWidgetsBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.2, *) {
            OverdeckLiveActivityWidget()
        }
    }
}
