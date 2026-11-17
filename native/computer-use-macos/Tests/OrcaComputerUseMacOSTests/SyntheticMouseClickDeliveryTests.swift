@testable import OrcaComputerUseMacOSCore
import XCTest

final class SyntheticMouseClickDeliveryTests: XCTestCase {
    private typealias Delivery = SyntheticMouseClickDelivery
    private let target = Delivery.Recipient(ownerPID: 1, windowID: 2)
    private let other = Delivery.Recipient(ownerPID: 3, windowID: 4)

    func testClickChecksTheRecipientBeforeMovingThePointer() {
        var posted: [Delivery.Step] = []

        XCTAssertThrowsError(
            try Delivery.deliver(
                clickCount: 1,
                target: target,
                currentObservation: { .focused(self.other) },
                makeEvent: { $0 },
                post: { posted.append($0) },
                pause: { _ in }
            )
        ) { error in
            XCTAssertEqual(
                error as? Delivery.FenceFailure,
                .recipientChanged(expected: target, actual: other, deliveredPresses: 0)
            )
        }
        XCTAssertTrue(posted.isEmpty)
    }

    func testClickOnTheFocusedTargetPostsMoveDownAndUp() throws {
        var posted: [Delivery.Step] = []

        try Delivery.deliver(
            clickCount: 1,
            target: target,
            currentObservation: { .focused(self.target) },
            makeEvent: { $0 },
            post: { posted.append($0) },
            pause: { _ in }
        )

        XCTAssertEqual(posted, [.move, .buttonDown(pressIndex: 1), .buttonUp(pressIndex: 1)])
    }
}
