import XCTest
@testable import AgentServerCore

final class AgentPromptEditorTests: XCTestCase {
    // MARK: - Frontmatter splitting

    func testSplitsFrontmatterWhenPresent() {
        let source = """
        ---
        id: test
        name: Test Agent
        ---

        # Heading

        Body content here.
        """
        let parsed = AgentPromptDocument(source: source)

        XCTAssertEqual(parsed.frontmatter, "---\nid: test\nname: Test Agent\n---\n")
        XCTAssertEqual(parsed.body, """

        # Heading

        Body content here.
        """)
    }

    func testNoFrontmatterLeavesBodyUntouched() {
        let source = """
        # Just a body

        No frontmatter at all.
        """
        let parsed = AgentPromptDocument(source: source)

        XCTAssertEqual(parsed.frontmatter, "")
        XCTAssertEqual(parsed.body, source)
    }

    func testUnterminatedFrontmatterTreatedAsBody() {
        let source = """
        ---
        id: test
        name: oops no closing fence

        # Body
        """
        let parsed = AgentPromptDocument(source: source)

        XCTAssertEqual(parsed.frontmatter, "")
        XCTAssertEqual(parsed.body, source)
    }

    // MARK: - Serialization

    func testSerializePreservesFrontmatterVerbatim() {
        let source = """
        ---
        id: test
        name: Test
        ---

        Old body.
        """
        let doc = AgentPromptDocument(source: source)
        let updated = doc.serialize(newBody: "\nNew body content.\n")

        XCTAssertTrue(updated.hasPrefix("""
        ---
        id: test
        name: Test
        ---
        """))
        XCTAssertTrue(updated.contains("New body content."))
        XCTAssertFalse(updated.contains("Old body."))
    }

    func testSerializeWithoutFrontmatterIsJustBody() {
        let doc = AgentPromptDocument(source: "original body")
        XCTAssertEqual(doc.serialize(newBody: "replacement body"), "replacement body")
    }

    func testSerializeUnchangedBodyPreservesExactFrontmatterBoundary() {
        let sources = [
            "---\nid: x\n---\nPrompt",
            "---\r\nid: x\r\n---\r\nPrompt\r\n",
            "---\nid: x\n---\nPrompt without final newline",
        ]

        for source in sources {
            let document = AgentPromptDocument(source: source)
            XCTAssertEqual(document.serialize(newBody: document.body), source)
        }
    }

    // MARK: - Round-trip on disk

    func testSaveRoundTripPreservesFrontmatter() throws {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("agent-prompt-test-\(UUID().uuidString).md")
        let original = """
        ---
        id: round-trip
        name: RT
        ---

        Original prompt body.
        """
        try original.write(to: tmp, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let read = try String(contentsOf: tmp, encoding: .utf8)
        let doc = AgentPromptDocument(source: read)
        let newBody = "\nEdited prompt body.\n"
        let newContents = doc.serialize(newBody: newBody)
        try newContents.data(using: .utf8)!.write(to: tmp, options: .atomic)

        let reloaded = try String(contentsOf: tmp, encoding: .utf8)
        let reparsed = AgentPromptDocument(source: reloaded)

        XCTAssertEqual(reparsed.frontmatter, doc.frontmatter)
        XCTAssertEqual(reparsed.body, newBody)
    }

    // MARK: - Dirty tracking

    func testInitialStateIsClean() {
        let model = AgentPromptEditorModel(source: "---\nid: x\n---\n\nbody")
        XCTAssertFalse(model.isDirty)
    }

    func testEditFlipsDirty() {
        let model = AgentPromptEditorModel(source: "---\nid: x\n---\n\nbody")
        model.body = "body modified"
        XCTAssertTrue(model.isDirty)
    }

    func testMarkSavedResetsDirty() {
        let model = AgentPromptEditorModel(source: "---\nid: x\n---\n\nbody")
        model.body = "body modified"
        XCTAssertTrue(model.isDirty)
        model.markSaved()
        XCTAssertFalse(model.isDirty)
    }

    func testEditingBackToOriginalIsStillDirty() {
        // Once edited, dirty flag stays true until explicit save — even if the
        // user types it back. Cheaper than tracking a baseline and matches
        // standard editor behavior.
        let model = AgentPromptEditorModel(source: "---\nid: x\n---\n\nbody")
        let originalBody = model.body
        model.body = "changed"
        model.body = originalBody
        XCTAssertTrue(model.isDirty)
    }
}
