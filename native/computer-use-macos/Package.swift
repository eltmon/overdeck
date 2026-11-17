// swift-tools-version: 6.0
// Ported from Orca (MIT, Copyright (c) 2026 Lovecast Inc.)
// upstream: native/computer-use-macos/Package.swift @ c6b9ac9549b
// modified for Overdeck: executable product renamed

import PackageDescription

let package = Package(
    name: "OrcaComputerUseMacOS",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "OrcaComputerUseMacOSCore",
            targets: ["OrcaComputerUseMacOSCore"]
        ),
        .executable(
            name: "overdeck-computer-use-macos",
            targets: ["OrcaComputerUseMacOS"]
        )
    ],
    targets: [
        .target(
            name: "OrcaComputerUseMacOSCore",
            path: "Sources/OrcaComputerUseMacOSCore"
        ),
        .executableTarget(
            name: "OrcaComputerUseMacOS",
            dependencies: ["OrcaComputerUseMacOSCore"],
            path: "Sources/OrcaComputerUseMacOS"
        ),
        .testTarget(
            name: "OrcaComputerUseMacOSTests",
            dependencies: ["OrcaComputerUseMacOSCore"],
            path: "Tests/OrcaComputerUseMacOSTests"
        )
    ]
)
