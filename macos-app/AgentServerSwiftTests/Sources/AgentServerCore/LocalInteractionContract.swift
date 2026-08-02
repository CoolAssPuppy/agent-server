import Foundation

public struct LocalInteraction: Decodable, Equatable, Sendable {
    public let interactionID: String
    public let runID: String
    public let assistantID: String
    public let message: String
    public let options: [LocalInteractionOption]
    public let allowsFreeText: Bool
    public let expiresAt: Date
    public let status: LocalInteractionStatus

    private enum CodingKeys: String, CodingKey {
        case interactionID = "interaction_id"
        case runID = "run_id"
        case assistantID = "assistant_id"
        case message, options
        case allowsFreeText = "allows_free_text"
        case expiresAt = "expires_at"
        case status
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        interactionID = try container.decode(String.self, forKey: .interactionID)
        runID = try container.decode(String.self, forKey: .runID)
        assistantID = try container.decode(String.self, forKey: .assistantID)
        message = try container.decode(String.self, forKey: .message)
        options = try container.decode([LocalInteractionOption].self, forKey: .options)
        allowsFreeText = try container.decode(Bool.self, forKey: .allowsFreeText)
        status = try container.decode(LocalInteractionStatus.self, forKey: .status)

        let expiry = try container.decode(String.self, forKey: .expiresAt)
        guard let date = LocalInteractionDateParser.date(from: expiry) else {
            throw DecodingError.dataCorruptedError(
                forKey: .expiresAt,
                in: container,
                debugDescription: "Invalid interaction expiry date"
            )
        }
        expiresAt = date
    }
}

public struct LocalInteractionOption: Decodable, Equatable, Sendable {
    public let index: Int
    public let label: String
    public let description: String?

    public init(index: Int, label: String, description: String?) {
        self.index = index
        self.label = label
        self.description = description
    }
}

public enum LocalInteractionStatus: Equatable, Sendable {
    case pending
    case processing
    case acted
    case expired
    case unknown(String)

    public var canRespond: Bool {
        self == .pending
    }
}

extension LocalInteractionStatus: Decodable {
    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = switch value {
        case "pending": .pending
        case "processing": .processing
        case "acted": .acted
        case "expired": .expired
        default: .unknown(value)
        }
    }
}

public enum LocalInteractionReply: Encodable, Equatable, Sendable {
    case option(index: Int)
    case text(String)

    private enum EnvelopeKeys: String, CodingKey {
        case response
    }

    private enum ResponseKeys: String, CodingKey {
        case type, optionIndex, text
    }

    public func encode(to encoder: Encoder) throws {
        var envelope = encoder.container(keyedBy: EnvelopeKeys.self)
        var response = envelope.nestedContainer(keyedBy: ResponseKeys.self, forKey: .response)

        switch self {
        case .option(let index):
            try response.encode("option", forKey: .type)
            try response.encode(index, forKey: .optionIndex)
        case .text(let text):
            try response.encode("text", forKey: .type)
            try response.encode(text, forKey: .text)
        }
    }
}

public struct InteractionReplyAcceptance: Decodable, Equatable, Sendable {
    public let interactionID: String
    public let runID: String
    public let status: InteractionReplyAcceptanceStatus

    private enum CodingKeys: String, CodingKey {
        case interactionID = "interaction_id"
        case runID = "run_id"
        case status
    }
}

public enum InteractionReplyAcceptanceStatus: Equatable, Sendable {
    case accepted
    case unknown(String)
}

extension InteractionReplyAcceptanceStatus: Decodable {
    public init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = value == "accepted" ? .accepted : .unknown(value)
    }
}

private enum LocalInteractionDateParser {
    static func date(from value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) {
            return date
        }

        return ISO8601DateFormatter().date(from: value)
    }
}
