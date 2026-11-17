// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: native/computer-use-macos/Sources/OrcaComputerUseMacOSCore/KeyboardInputSafety.swift @ c6b9ac9549b
public enum KeyboardInputSafety {
    public enum FocusFailure: Equatable {
        case targetNotFocused
        case targetNotFocusedAfterRestore
    }

    public static func syntheticInputFocusFailure(targetWindowFocused: Bool, restoreWindowRequested: Bool) -> FocusFailure? {
        guard !targetWindowFocused else {
            return nil
        }
        return restoreWindowRequested ? .targetNotFocusedAfterRestore : .targetNotFocused
    }
}
