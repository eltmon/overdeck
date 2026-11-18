@testable import OrcaComputerUseMacOSCore
import XCTest

final class ActionArgumentValidationTests: XCTestCase {
    func testPositiveIntegerAcceptsWholeNumbersAndDefaults() {
        XCTAssertEqual(try ActionArgumentValidation.positiveInteger(1, defaultValue: 1, name: "clickCount").get(), 1)
        XCTAssertEqual(try ActionArgumentValidation.positiveInteger(3, defaultValue: 1, name: "clickCount").get(), 3)
        XCTAssertEqual(try ActionArgumentValidation.positiveInteger(nil, defaultValue: 2, name: "clickCount").get(), 2)
    }

    func testPositiveIntegerRejectsFractionsInsteadOfTruncating() {
        for value in [0.5, 1.5] {
            XCTAssertEqual(
                ActionArgumentValidation.positiveInteger(value, defaultValue: 1, name: "clickCount"),
                .failure(ActionArgumentValidationError("clickCount must be a positive integer"))
            )
        }
    }

    func testPositiveIntegerRejectsZeroNegativeAndNonFinite() {
        for value in [0, -1, Double.infinity, Double.nan] {
            XCTAssertThrowsError(try ActionArgumentValidation.positiveInteger(value, defaultValue: 1, name: "n").get())
        }
    }
}
