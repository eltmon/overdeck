// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: native/computer-use-macos/Sources/OrcaComputerUseMacOSCore/PermissionWindowCopy.swift @ c6b9ac9549b
// modified for Overdeck: Orca renamed to Overdeck in the window copy
import Foundation

public struct PermissionWindowCopy: Equatable, Sendable {
    public let windowTitle: String
    public let checkingTitle: String
    public let readyTitle: String
    public let enableTitle: String
    public let checkingSubtitle: String
    public let readySubtitle: String
    public let permissionSubtitle: String
    public let accessibilityTitle: String
    public let accessibilityDetail: String
    public let screenshotsTitle: String
    public let screenshotsDetail: String
    public let screenRecordingDescription: String
    public let allowButton: String
    public let doneButton: String
    public let dragWindowTitle: String
    public let dragAccessibilityInstruction: String
    public let dragScreenshotsInstruction: String
    public let closeButtonDescription: String

    public init(localeIdentifier: String?) {
        let normalized = (localeIdentifier ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "-")
        if normalized == "zh" || normalized.hasPrefix("zh-cn") || normalized.hasPrefix("zh-hans") {
            self = Self.chinese
        } else {
            self = Self.english
        }
    }

    private static let english = PermissionWindowCopy(
        windowTitle: "Enable Overdeck Computer Use",
        checkingTitle: "Checking Computer Use",
        readyTitle: "Computer Use is Ready",
        enableTitle: "Enable Overdeck Computer Use",
        checkingSubtitle: "Checking Accessibility and Screenshots.",
        readySubtitle: "Overdeck can use local apps when you ask.",
        permissionSubtitle: "Grant permissions so Overdeck can use apps when you ask.",
        accessibilityTitle: "Accessibility",
        accessibilityDetail: "Read and control app interfaces",
        screenshotsTitle: "Screenshots",
        screenshotsDetail: "Capture windows for visual state",
        screenRecordingDescription: "Screen Recording",
        allowButton: "Allow",
        doneButton: "Done",
        dragWindowTitle: "Drag Overdeck Computer Use",
        dragAccessibilityInstruction: "Drag Overdeck Computer Use into the list above to allow Accessibility.",
        dragScreenshotsInstruction: "Drag Overdeck Computer Use into the list above to allow Screenshots.",
        closeButtonDescription: "Close"
    )

    private static let chinese = PermissionWindowCopy(
        windowTitle: "启用 Overdeck 计算机使用功能",
        checkingTitle: "正在检查计算机使用权限",
        readyTitle: "计算机使用功能已就绪",
        enableTitle: "启用 Overdeck 计算机使用功能",
        checkingSubtitle: "正在检查辅助功能和屏幕截图权限。",
        readySubtitle: "当你提出要求时，Overdeck 可以使用本地应用。",
        permissionSubtitle: "授予权限，以便 Overdeck 在你提出要求时使用应用。",
        accessibilityTitle: "辅助功能",
        accessibilityDetail: "读取并控制应用界面",
        screenshotsTitle: "屏幕截图",
        screenshotsDetail: "捕获窗口以识别视觉状态",
        screenRecordingDescription: "屏幕录制",
        allowButton: "允许",
        doneButton: "完成",
        dragWindowTitle: "拖入 Overdeck Computer Use",
        dragAccessibilityInstruction: "将 Overdeck Computer Use 拖入上方列表以允许辅助功能。",
        dragScreenshotsInstruction: "将 Overdeck Computer Use 拖入上方列表以允许屏幕截图。",
        closeButtonDescription: "关闭"
    )

    private init(
        windowTitle: String,
        checkingTitle: String,
        readyTitle: String,
        enableTitle: String,
        checkingSubtitle: String,
        readySubtitle: String,
        permissionSubtitle: String,
        accessibilityTitle: String,
        accessibilityDetail: String,
        screenshotsTitle: String,
        screenshotsDetail: String,
        screenRecordingDescription: String,
        allowButton: String,
        doneButton: String,
        dragWindowTitle: String,
        dragAccessibilityInstruction: String,
        dragScreenshotsInstruction: String,
        closeButtonDescription: String
    ) {
        self.windowTitle = windowTitle
        self.checkingTitle = checkingTitle
        self.readyTitle = readyTitle
        self.enableTitle = enableTitle
        self.checkingSubtitle = checkingSubtitle
        self.readySubtitle = readySubtitle
        self.permissionSubtitle = permissionSubtitle
        self.accessibilityTitle = accessibilityTitle
        self.accessibilityDetail = accessibilityDetail
        self.screenshotsTitle = screenshotsTitle
        self.screenshotsDetail = screenshotsDetail
        self.screenRecordingDescription = screenRecordingDescription
        self.allowButton = allowButton
        self.doneButton = doneButton
        self.dragWindowTitle = dragWindowTitle
        self.dragAccessibilityInstruction = dragAccessibilityInstruction
        self.dragScreenshotsInstruction = dragScreenshotsInstruction
        self.closeButtonDescription = closeButtonDescription
    }
}
