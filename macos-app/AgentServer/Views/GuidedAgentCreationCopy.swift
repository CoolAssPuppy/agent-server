struct GuidedAgentCreationCopy {
    let title: String
    let explanation: String
    let example: String

    static let newAgent = Self(
        title: "What would you like this agent to do?",
        explanation: "Describe the result you want. You can include when it should run, what it should read, and where the result should go.",
        example: CreationRequestEditorPresentation.helperText
    )

    static let similarAgent = Self(
        title: "What would you like to change?",
        explanation: "Describe only the changes you want. Private connection details and run history are never copied.",
        example: "Example: Run this on Mondays instead, and save the summary as a file."
    )
}
