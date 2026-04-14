// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AgentServerSwiftTests",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "AgentServerCore", targets: ["AgentServerCore"]),
    ],
    targets: [
        .target(
            name: "AgentServerCore",
            path: "Sources/AgentServerCore"
        ),
        .testTarget(
            name: "AgentServerCoreTests",
            dependencies: ["AgentServerCore"],
            path: "Tests/AgentServerCoreTests"
        ),
    ]
)
