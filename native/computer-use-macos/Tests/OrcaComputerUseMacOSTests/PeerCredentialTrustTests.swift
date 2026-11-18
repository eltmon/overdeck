import Foundation
@testable import OrcaComputerUseMacOSCore
import XCTest

final class PeerCredentialTrustTests: XCTestCase {
    func testAuthorizesAPeerWithTheSameUid() {
        XCTAssertTrue(PeerCredentialTrust.isAuthorized(peerUid: 501, ownUid: 501))
    }

    func testRejectsAPeerWithADifferentUid() {
        XCTAssertFalse(PeerCredentialTrust.isAuthorized(peerUid: 502, ownUid: 501))
    }

    func testRejectsRootWhenTheHelperIsNotRoot() {
        XCTAssertFalse(PeerCredentialTrust.isAuthorized(peerUid: 0, ownUid: 501))
    }
}
