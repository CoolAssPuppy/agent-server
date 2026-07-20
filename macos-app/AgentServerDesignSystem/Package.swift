// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "AgentServerDesignSystem",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .library(name: "AgentServerDesignSystem", targets: ["AgentServerDesignSystem"]),
    ],
    targets: [
        .target(name: "AgentServerDesignSystem"),
        .testTarget(name: "AgentServerDesignSystemTests", dependencies: ["AgentServerDesignSystem"]),
    ]
)
