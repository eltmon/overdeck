// swift-tools-version: 5.9
import PackageDescription

// The phone app's push decryption and Keychain code, shared by the App and NotificationService targets (PAN-4838 D-1).
let package = Package(
    name: "OverdeckPush",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "OverdeckPush", targets: ["OverdeckPush"])],
    dependencies: [.package(url: "https://github.com/jedisct1/swift-sodium.git", exact: "0.9.1")],
    targets: [
        .target(name: "OverdeckPush", dependencies: [.product(name: "Sodium", package: "swift-sodium")]),
        .testTarget(
            name: "OverdeckPushTests",
            dependencies: ["OverdeckPush", .product(name: "Sodium", package: "swift-sodium")]
        ),
    ]
)
