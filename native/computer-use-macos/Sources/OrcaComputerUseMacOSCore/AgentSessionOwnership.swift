// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: native/computer-use-macos/Sources/OrcaComputerUseMacOSCore/AgentSessionOwnership.swift @ c6b9ac9549b
// modified for Overdeck: no session latch; the shared daemon accepts reconnects
public struct AgentSessionConnectionID: Hashable, Sendable {
    public let rawValue: UInt64

    public init(rawValue: UInt64) {
        self.rawValue = rawValue
    }
}

public enum AgentSessionRegistration: Sendable {
    case rejected
    case claimed
    case retained
}

// Overdeck: one daemon serves many short-lived `pan computer` processes, so the
// last connection closing no longer ends the session. Only the first
// authenticated connection ever is `.claimed`; every later one is `.retained`.
public struct AgentSessionOwnership: Sendable {
    private var authenticatedConnections: Set<AgentSessionConnectionID> = []
    private var wasClaimed = false

    public init() {}

    public mutating func registerConnection(
        _ connection: AgentSessionConnectionID,
        authenticated: Bool
    ) -> AgentSessionRegistration {
        guard authenticated else { return .rejected }
        let inserted = authenticatedConnections.insert(connection).inserted
        guard inserted else { return .rejected }
        guard !wasClaimed else { return .retained }
        wasClaimed = true
        return .claimed
    }

    /// Forgets the connection. It never ends the daemon; the idle timer does.
    public mutating func disconnect(_ connection: AgentSessionConnectionID) {
        authenticatedConnections.remove(connection)
    }
}

public func isAuthenticatedAgentSession(
    expectedToken: String?,
    requestToken: String?,
    authorizedPeer: Bool
) -> Bool {
    guard authorizedPeer else { return false }
    guard let expectedToken else { return true }
    return requestToken == expectedToken
}
