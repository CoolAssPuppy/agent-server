// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "NerdsUI",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .library(name: "NerdsUI", targets: ["NerdsUI"]),
    ],
    targets: [
        .target(name: "NerdsUI", path: "Sources/NerdsUI"),
        .testTarget(name: "NerdsUITests", dependencies: ["NerdsUI"]),
    ]
)
