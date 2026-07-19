import Foundation

public struct ConnectionCatalogService: Equatable, Sendable {
    public let id: String
    public let name: String
    public let requiredEnvironmentKeys: [String]

    public init(id: String, name: String, requiredEnvironmentKeys: [String]) {
        self.id = id
        self.name = name
        self.requiredEnvironmentKeys = requiredEnvironmentKeys
    }
}

public enum ConnectionCredentialAction: Equatable, Sendable {
    case addKeys
    case modifyKeys
    case addAnother

    public var title: String {
        switch self {
        case .addKeys: "Set up"
        case .modifyKeys: "Modify connection"
        case .addAnother: "Add another"
        }
    }
}

public enum ConnectionCredentialStatus: Equatable, Sendable {
    case connected
    case needsSetup
    case unavailable
}

public struct ConnectionCredentialRow: Equatable, Identifiable, Sendable {
    public let id: String
    public let serviceId: String
    public let name: String
    public let status: ConnectionCredentialStatus
    public let action: ConnectionCredentialAction
    public let requiredEnvironmentKeys: [String]

    public init(
        id: String,
        serviceId: String,
        name: String,
        status: ConnectionCredentialStatus,
        action: ConnectionCredentialAction,
        requiredEnvironmentKeys: [String]
    ) {
        self.id = id
        self.serviceId = serviceId
        self.name = name
        self.status = status
        self.action = action
        self.requiredEnvironmentKeys = requiredEnvironmentKeys
    }
}

public struct ConnectionCredentialsPresentation: Equatable, Sendable {
    public let rows: [ConnectionCredentialRow]

    public init(
        catalog: [ConnectionCatalogService],
        connections: [GuidanceServiceConnection]
    ) {
        rows = catalog.flatMap { service in
            Self.rows(for: service, connections: connections)
        }
    }

    private static func rows(
        for service: ConnectionCatalogService,
        connections: [GuidanceServiceConnection]
    ) -> [ConnectionCredentialRow] {
        let candidates = connections.filter {
            $0.serviceId == service.id
                && $0.source == "configured_api"
                && !$0.requiredEnvironmentKeys.isEmpty
        }
        let named = candidates.filter { !$0.id.hasPrefix("catalog:") }
        if !named.isEmpty {
            return named.map(Self.configuredRow) + [ConnectionCredentialRow(
                id: "add:\(service.id)",
                serviceId: service.id,
                name: service.name,
                status: .needsSetup,
                action: .addAnother,
                requiredEnvironmentKeys: service.requiredEnvironmentKeys
            )]
        }
        if let catalogConnection = candidates.first(where: { $0.id.hasPrefix("catalog:") }) {
            return [configuredRow(catalogConnection)]
        }
        return [ConnectionCredentialRow(
            id: "add:\(service.id)",
            serviceId: service.id,
            name: service.name,
            status: .needsSetup,
            action: .addKeys,
            requiredEnvironmentKeys: service.requiredEnvironmentKeys
        )]
    }

    private static func configuredRow(
        _ connection: GuidanceServiceConnection
    ) -> ConnectionCredentialRow {
        ConnectionCredentialRow(
            id: connection.id,
            serviceId: connection.serviceId,
            name: connection.name,
            status: status(connection.status),
            action: connection.status == "connected" ? .modifyKeys : .addKeys,
            requiredEnvironmentKeys: connection.requiredEnvironmentKeys
        )
    }

    private static func status(_ value: String) -> ConnectionCredentialStatus {
        switch value {
        case "connected": .connected
        case "unavailable", "conflict": .unavailable
        default: .needsSetup
        }
    }
}
