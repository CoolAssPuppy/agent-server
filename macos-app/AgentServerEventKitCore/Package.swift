// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AgentServerEventKitCore",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "AgentServerEventKitCore", targets: ["AgentServerEventKitCore"]),
    ],
    targets: [
        .target(name: "AgentServerEventKitCore"),
        .testTarget(
            name: "AgentServerEventKitCoreTests",
            dependencies: ["AgentServerEventKitCore"]
        ),
    ]
)
