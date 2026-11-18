import Dispatch
import Foundation
@testable import OrcaComputerUseMacOSCore
import XCTest

private final class ProbeCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var calls = 0

    func next() -> Int {
        lock.lock()
        defer { lock.unlock() }
        calls += 1
        return calls
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return calls
    }
}

final class PermissionStatusRefreshCoordinatorTests: XCTestCase {
    func testRefreshesAskedForDuringAProbeRunOneMoreProbe() {
        let started = DispatchSemaphore(value: 0)
        let release = DispatchSemaphore(value: 0)
        let counter = ProbeCounter()
        let handled = expectation(description: "first probe and one coalesced follow-up")
        handled.expectedFulfillmentCount = 2

        let coordinator = PermissionStatusRefreshCoordinator(
            workerQueue: DispatchQueue(label: "test.permission-refresh.worker"),
            callbackQueue: DispatchQueue(label: "test.permission-refresh.callback"),
            probe: {
                let call = counter.next()
                if call == 1 {
                    started.signal()
                    release.wait()
                }
                return PermissionStatusSnapshot(accessibilityGranted: call > 1, screenshotsGranted: false)
            },
            handler: { _ in handled.fulfill() }
        )

        coordinator.refresh()
        started.wait()
        coordinator.refresh()
        coordinator.refresh()
        release.signal()

        wait(for: [handled], timeout: 5)
        XCTAssertEqual(counter.count, 2)
    }
}
