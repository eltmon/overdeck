@testable import OrcaComputerUseMacOSCore
import XCTest

final class AgentSessionOwnershipTests: XCTestCase {
    func testFirstAuthenticatedConnectionClaimsTheSession() {
        var ownership = AgentSessionOwnership()
        XCTAssertEqual(ownership.registerConnection(connection(1), authenticated: true), .claimed)
    }

    func testReconnectAfterTheLastConnectionClosesIsRetained() {
        var ownership = AgentSessionOwnership()
        XCTAssertEqual(ownership.registerConnection(connection(1), authenticated: true), .claimed)
        ownership.disconnect(connection(1))
        XCTAssertEqual(ownership.registerConnection(connection(2), authenticated: true), .retained)
    }

    func testConcurrentConnectionsAfterTheClaimAreRetained() {
        var ownership = AgentSessionOwnership()
        XCTAssertEqual(ownership.registerConnection(connection(1), authenticated: true), .claimed)
        XCTAssertEqual(ownership.registerConnection(connection(2), authenticated: true), .retained)
    }

    func testUnauthenticatedConnectionIsRejected() {
        var ownership = AgentSessionOwnership()
        XCTAssertEqual(ownership.registerConnection(connection(1), authenticated: false), .rejected)
    }

    func testRegisteringTheSameConnectionTwiceIsRejected() {
        var ownership = AgentSessionOwnership()
        XCTAssertEqual(ownership.registerConnection(connection(1), authenticated: true), .claimed)
        XCTAssertEqual(ownership.registerConnection(connection(1), authenticated: true), .rejected)
    }

    private func connection(_ rawValue: UInt64) -> AgentSessionConnectionID {
        AgentSessionConnectionID(rawValue: rawValue)
    }
}
