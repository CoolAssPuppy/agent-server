import XCTest
@testable import AgentServerCore

final class AgentEnabledFileEditorTests: XCTestCase {
    func testUpdatesOnlyEnabledValueInLFFiles() throws {
        let source = "---\nid: example\nname: Example\nenabled: false\n---\nPrompt text"

        let updated = try AgentEnabledFileEditor.updatingEnabled(in: source, to: true)

        XCTAssertEqual(updated, "---\nid: example\nname: Example\nenabled: true\n---\nPrompt text")
    }

    func testPreservesCRLFLineEndings() throws {
        let source = "---\r\nid: example\r\nenabled: false\r\n---\r\nPrompt\r\n"

        let updated = try AgentEnabledFileEditor.updatingEnabled(in: source, to: true)

        XCTAssertEqual(updated, "---\r\nid: example\r\nenabled: true\r\n---\r\nPrompt\r\n")
    }

    func testPreservesNoFinalNewline() throws {
        let source = "---\nid: example\nenabled: false\n---\nPrompt"

        let updated = try AgentEnabledFileEditor.updatingEnabled(in: source, to: true)

        XCTAssertFalse(updated.hasSuffix("\n"))
        XCTAssertEqual(updated, "---\nid: example\nenabled: true\n---\nPrompt")
    }

    func testPreservesMultilineYamlCommentsWhitespaceAndKeyOrder() throws {
        let source = """
        ---
        # Keep this comment
        id: example
        description: |
          enabled: false inside a multiline value
          --- inside content
        enabled :  false  # keep inline comment
        name: Example
        ---
        Prompt with enabled: false text
        """

        let updated = try AgentEnabledFileEditor.updatingEnabled(in: source, to: true)

        XCTAssertEqual(updated, source.replacingOccurrences(
            of: "enabled :  false  # keep inline comment",
            with: "enabled :  true  # keep inline comment"
        ))
        XCTAssertTrue(try AgentEnabledFileEditor.enabled(in: updated))
    }

    func testRepeatedTogglesAreIdempotent() throws {
        let original = "---\nid: example\nenabled: false\n---\nPrompt"
        let enabled = try AgentEnabledFileEditor.updatingEnabled(in: original, to: true)

        XCTAssertEqual(try AgentEnabledFileEditor.updatingEnabled(in: enabled, to: true), enabled)
        XCTAssertEqual(try AgentEnabledFileEditor.updatingEnabled(in: enabled, to: false), original)
    }

    func testRejectsUnterminatedFrontmatterWithoutWriting() throws {
        let source = "---\nid: example\nenabled: false\nPrompt"
        let url = try temporaryFile(contents: source)
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }

        XCTAssertThrowsError(try AgentEnabledFileEditor.setEnabled(at: url, to: true))
        XCTAssertEqual(try String(contentsOf: url, encoding: .utf8), source)
    }

    func testRejectsDuplicateEnabledKeysWithoutWriting() throws {
        let source = "---\nid: example\nenabled: false\nenabled: true\n---\nPrompt"
        let url = try temporaryFile(contents: source)
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }

        XCTAssertThrowsError(try AgentEnabledFileEditor.setEnabled(at: url, to: true))
        XCTAssertEqual(try String(contentsOf: url, encoding: .utf8), source)
    }

    func testRejectsInvalidEnabledValueWithoutWriting() throws {
        let source = "---\nid: example\nenabled: sometimes\n---\nPrompt"
        let url = try temporaryFile(contents: source)
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }

        XCTAssertThrowsError(try AgentEnabledFileEditor.setEnabled(at: url, to: true))
        XCTAssertEqual(try String(contentsOf: url, encoding: .utf8), source)
    }

    func testAtomicWriteDoesNotModifyAnotherDefinition() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("agent-enabled-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let target = directory.appendingPathComponent("target.md")
        let sibling = directory.appendingPathComponent("sibling.md")
        let targetSource = "---\nid: target\nenabled: false\n---\nTarget"
        let siblingSource = "---\nid: sibling\nenabled: false\n---\nSibling"
        try targetSource.write(to: target, atomically: true, encoding: .utf8)
        try siblingSource.write(to: sibling, atomically: true, encoding: .utf8)

        _ = try AgentEnabledFileEditor.setEnabled(at: target, to: true)

        XCTAssertEqual(try String(contentsOf: sibling, encoding: .utf8), siblingSource)
        XCTAssertEqual(
            try String(contentsOf: target, encoding: .utf8),
            "---\nid: target\nenabled: true\n---\nTarget"
        )
    }

    private func temporaryFile(contents: String) throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("agent-enabled-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("agent.md")
        try contents.write(to: url, atomically: true, encoding: .utf8)
        return url
    }
}
