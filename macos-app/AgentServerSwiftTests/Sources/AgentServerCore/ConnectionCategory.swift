import Foundation

public enum ConnectionCategory: String, Equatable, Sendable {
    case api
    case mcp
    case file
    case web
    case command
    case mac
    case messaging
    case tool

    public init(source: String) {
        switch source {
        case "configured_api": self = .api
        case "account", "mcp": self = .mcp
        case "macos": self = .mac
        case "file": self = .file
        case "web": self = .web
        case "command": self = .command
        default: self = .tool
        }
    }

    public init(
        capabilityID: String,
        kind: String,
        auth: String,
        source: String?
    ) {
        if let source {
            self.init(source: source)
            return
        }
        switch capabilityID {
        case "read-files", "write-files": self = .file
        case "run-commands": self = .command
        case "browse-web": self = .web
        default:
            if kind == "channel" { self = .messaging }
            else if kind == "mcp" && auth == "api_key" { self = .api }
            else if kind == "mcp" { self = .mcp }
            else { self = .tool }
        }
    }

    public var label: String {
        switch self {
        case .api: "API"
        case .mcp: "MCP"
        case .file: "File"
        case .web: "Web"
        case .command: "Command"
        case .mac: "Mac"
        case .messaging: "Messaging"
        case .tool: "Tool"
        }
    }
}
