import Foundation
import Combine

/// Observable model backing the in-drawer agent prompt editor. Tracks the
/// editable body, a dirty flag that flips on first mutation, and the preserved
/// frontmatter that must be written back on save.
public final class AgentPromptEditorModel: ObservableObject {
    @Published public var body: String {
        didSet {
            if !isDirty && body != oldValue {
                isDirty = true
            }
        }
    }

    @Published public private(set) var isDirty: Bool = false

    public let frontmatter: String

    public init(source: String) {
        let doc = AgentPromptDocument(source: source)
        self.frontmatter = doc.frontmatter
        self.body = doc.body
    }

    /// Rebuild the full document with the current body for writing back to disk.
    public func serialize() -> String {
        let doc = AgentPromptDocument(source: frontmatter + body)
        // The document object only exists to reuse the serializer; if the
        // frontmatter portion was empty we still want to emit just the body.
        _ = doc
        return frontmatter.isEmpty ? body : frontmatter + body
    }

    public func markSaved() {
        isDirty = false
    }
}
