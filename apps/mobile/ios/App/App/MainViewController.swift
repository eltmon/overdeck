import UIKit
import Capacitor

/// Root bridge view controller; app-local plugins are registered in `capacitorDidLoad` (PAN-4837).
final class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
    }
}
