import Foundation

struct InteractionResponseDraft: Equatable, Sendable {
    let allowsFreeText: Bool
    private(set) var selectedOptionIndex: Int?
    private(set) var text = ""

    var reply: LocalInteractionReply? {
        if let selectedOptionIndex {
            return .option(index: selectedOptionIndex)
        }
        let response = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard allowsFreeText, !response.isEmpty else { return nil }
        return .text(response)
    }

    var canSubmit: Bool { reply != nil }

    init(allowsFreeText: Bool) {
        self.allowsFreeText = allowsFreeText
    }

    mutating func selectOption(index: Int) {
        selectedOptionIndex = index
        text = ""
    }

    mutating func setText(_ value: String) {
        guard allowsFreeText else {
            text = ""
            return
        }
        selectedOptionIndex = nil
        text = value
    }
}
