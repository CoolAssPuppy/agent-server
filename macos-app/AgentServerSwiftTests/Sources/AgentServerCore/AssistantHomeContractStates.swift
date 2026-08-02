enum AssistantHealthState: Equatable, Sendable {
    case healthy, working, needsAttention, paused
    case unknown(String)
}

extension AssistantHealthState: Decodable {
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "healthy": .healthy
        case "working": .working
        case "needs_attention": .needsAttention
        case "paused": .paused
        default: .unknown(value)
        }
    }
}

enum AssistantReadinessState: Equatable, Sendable {
    case ready, needsSetup, blocked, checking, unavailable
    case unknown(String)
}

extension AssistantReadinessState: Decodable {
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "ready": .ready
        case "needs_setup": .needsSetup
        case "blocked": .blocked
        case "checking": .checking
        case "unavailable": .unavailable
        default: .unknown(value)
        }
    }
}

enum AssistantReadinessCheckKind: Equatable, Sendable {
    case engine, connection, file, destination, permission, schedule, server, mcp, safety
    case unknown(String)
}

extension AssistantReadinessCheckKind: Decodable {
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "engine": .engine
        case "connection": .connection
        case "file": .file
        case "destination": .destination
        case "permission": .permission
        case "schedule": .schedule
        case "server": .server
        case "mcp": .mcp
        case "safety": .safety
        default: .unknown(value)
        }
    }
}

enum AssistantReadinessCheckState: Equatable, Sendable {
    case pass, actionRequired, fail, unknownValue
    case unknown(String)
}

extension AssistantReadinessCheckState: Decodable {
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "pass": .pass
        case "action_required": .actionRequired
        case "fail": .fail
        case "unknown": .unknownValue
        default: .unknown(value)
        }
    }
}

enum AssistantScheduleKind: Equatable, Sendable {
    case scheduled, watching, onDemand
    case unknown(String)
}

extension AssistantScheduleKind: Decodable {
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "scheduled": .scheduled
        case "watching": .watching
        case "on_demand": .onDemand
        default: .unknown(value)
        }
    }
}

enum AssistantPermissionEffect: Equatable, Sendable {
    case can, mustAsk, cannot
    case unknown(String)
}

extension AssistantPermissionEffect: Decodable {
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "can": .can
        case "must_ask": .mustAsk
        case "cannot": .cannot
        default: .unknown(value)
        }
    }
}

enum AssistantPermissionAction: Equatable, Sendable {
    case read, edit, execute, send, publish, delete, connect
    case unknown(String)
}

extension AssistantPermissionAction: Decodable {
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "read": .read
        case "edit": .edit
        case "execute": .execute
        case "send": .send
        case "publish": .publish
        case "delete": .delete
        case "connect": .connect
        default: .unknown(value)
        }
    }
}

enum AssistantConnectionState: Equatable, Sendable {
    case ready, needsSetup, unavailable, unknownValue
    case unknown(String)
}

extension AssistantConnectionState: Decodable {
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "ready": .ready
        case "needs_setup": .needsSetup
        case "unavailable": .unavailable
        case "unknown": .unknownValue
        default: .unknown(value)
        }
    }
}

enum AssistantOutcomeState: Equatable, Sendable {
    case succeeded, partial, failed, canceled, skipped, working, waiting, unknownValue
    case unknown(String)
}

extension AssistantOutcomeState: Decodable {
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "succeeded": .succeeded
        case "partial": .partial
        case "failed": .failed
        case "canceled": .canceled
        case "skipped": .skipped
        case "working": .working
        case "waiting": .waiting
        case "unknown": .unknownValue
        default: .unknown(value)
        }
    }
}
