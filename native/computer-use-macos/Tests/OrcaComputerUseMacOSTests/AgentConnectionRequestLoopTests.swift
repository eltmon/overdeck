// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: native/computer-use-macos/Tests/OrcaComputerUseMacOSTests/AgentConnectionRequestLoopTests.swift @ c6b9ac9549b
import Foundation
@testable import OrcaComputerUseMacOSCore
import XCTest

final class AgentConnectionRequestLoopTests: XCTestCase {
    func testReleasesARequestsAutoreleasedObjectsBeforeTheNextRequest() {
        var lines = ["screenshot", "next"]
        weak var screenshotBuffer: NSObject?
        var releasedBeforeNextRequest: Bool?

        AgentConnectionRequestLoop.run(readLine: { lines.isEmpty ? nil : lines.removeFirst() }) { line in
            if line == "screenshot" {
                let buffer = NSObject()
                screenshotBuffer = buffer
                // Why: stands in for the objects AppKit PNG encoding leaves in the pool.
                _ = Unmanaged.passRetained(buffer).autorelease()
            } else {
                releasedBeforeNextRequest = screenshotBuffer == nil
            }
            return true
        }

        XCTAssertEqual(releasedBeforeNextRequest, true)
    }


}
