import Foundation

/// Decides whether a Unix-socket peer may drive this helper (Overdeck, PAN-5463).
///
/// The helper trusts a peer that runs as the same user as the helper itself. The
/// caller reads the peer's uid with `getpeereid`; the agent token is checked
/// separately, so a same-user peer still needs the token.
public enum PeerCredentialTrust {
    public static func isAuthorized(peerUid: uid_t, ownUid: uid_t) -> Bool {
        peerUid == ownUid
    }
}
