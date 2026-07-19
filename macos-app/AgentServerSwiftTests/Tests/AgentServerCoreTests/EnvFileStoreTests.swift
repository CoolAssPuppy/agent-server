import XCTest
@testable import AgentServerCore

final class EnvFileStoreTests: XCTestCase {

    // MARK: - Helpers

    private func tempURL(_ name: String = UUID().uuidString) -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("envfilestore-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("\(name).env")
    }

    // MARK: - isSecretKey

    func testIsSecretKeyMatchesApiKey() {
        XCTAssertTrue(EnvFileStore.isSecretKey("AGENT_SERVER_PANEL_API_KEY"))
    }

    func testIsSecretKeyMatchesSuffixes() {
        XCTAssertTrue(EnvFileStore.isSecretKey("STRIPE_SECRET"))
        XCTAssertTrue(EnvFileStore.isSecretKey("GITHUB_TOKEN"))
        XCTAssertTrue(EnvFileStore.isSecretKey("FOO_KEY"))
        XCTAssertTrue(EnvFileStore.isSecretKey("FOO_SECRET"))
        XCTAssertTrue(EnvFileStore.isSecretKey("FOO_TOKEN"))
    }

    func testIsSecretKeyDoesNotMatchPanelURL() {
        XCTAssertFalse(EnvFileStore.isSecretKey("AGENT_SERVER_PANEL_URL"))
        XCTAssertFalse(EnvFileStore.isSecretKey("PANEL_URL"))
        XCTAssertFalse(EnvFileStore.isSecretKey("KEY_PATH"))
        XCTAssertFalse(EnvFileStore.isSecretKey(""))
        XCTAssertFalse(EnvFileStore.isSecretKey("lowercase_key"))
    }

    // MARK: - Masking

    func testMaskedValueShowsLastFour() {
        let masked = EnvFileStore.masked(value: "ap_live_pxbK5KQcxYz1")
        XCTAssertEqual(masked, "••••xYz1")
    }

    func testMaskedValueForShortStringIsRaw() {
        XCTAssertEqual(EnvFileStore.masked(value: "ab"), "ab")
        XCTAssertEqual(EnvFileStore.masked(value: "abcd"), "abcd")
    }

    // MARK: - Load

    func testLoadParsesKeyValuePairs() throws {
        let url = tempURL()
        let content = """
        FOO=bar
        PANEL_URL=https://example.com
        API_KEY=sk_live_abcd
        """
        try content.write(to: url, atomically: true, encoding: .utf8)

        let pairs = try EnvFileStore.load(from: url)
        let dict = Dictionary(uniqueKeysWithValues: pairs.map { ($0.key, $0.value) })
        XCTAssertEqual(dict["FOO"], "bar")
        XCTAssertEqual(dict["PANEL_URL"], "https://example.com")
        XCTAssertEqual(dict["API_KEY"], "sk_live_abcd")
        XCTAssertEqual(pairs.count, 3)
    }

    func testLoadMarksSecretPairs() throws {
        let url = tempURL()
        try "API_KEY=abcd1234\nPANEL_URL=https://x\n".write(to: url, atomically: true, encoding: .utf8)

        let pairs = try EnvFileStore.load(from: url)
        let apiKey = pairs.first(where: { $0.key == "API_KEY" })
        let url1 = pairs.first(where: { $0.key == "PANEL_URL" })
        XCTAssertEqual(apiKey?.isSecret, true)
        XCTAssertEqual(url1?.isSecret, false)
    }

    func testLoadMissingFileReturnsEmpty() throws {
        let url = tempURL("does-not-exist-\(UUID().uuidString)")
        let pairs = try EnvFileStore.load(from: url)
        XCTAssertEqual(pairs, [])
    }

    func testValueLoadsNamedSecretWithoutExposingOtherValues() throws {
        let url = tempURL()
        try "AGENT_SERVER_API_KEY=local-secret\nOTHER_SECRET=do-not-return\n"
            .write(to: url, atomically: true, encoding: .utf8)

        let value = try EnvFileStore.value(forKey: "AGENT_SERVER_API_KEY", from: url)

        XCTAssertEqual(value, "local-secret")
    }

    func testValueReturnsNilForMissingOrEmptyKey() throws {
        let url = tempURL()
        try "AGENT_SERVER_API_KEY=\n"
            .write(to: url, atomically: true, encoding: .utf8)

        XCTAssertNil(try EnvFileStore.value(forKey: "AGENT_SERVER_API_KEY", from: url))
        XCTAssertNil(try EnvFileStore.value(forKey: "MISSING_KEY", from: url))
    }

    func testDefaultEnvironmentFileIsAgentServerDotEnv() {
        let home = URL(fileURLWithPath: "/Users/example", isDirectory: true)

        XCTAssertEqual(
            EnvFileStore.defaultURLs(homeDirectory: home),
            [home.appendingPathComponent(".agent-server/.env")]
        )
    }

    func testFirstValueUsesEnvironmentFileOrderAndSkipsMissingValues() throws {
        let base = tempURL().deletingLastPathComponent()
        let localURL = base.appendingPathComponent(".env.local")
        let envURL = base.appendingPathComponent(".env")
        try "OTHER=value\nAGENT_SERVER_PANEL_URL=\n"
            .write(to: localURL, atomically: true, encoding: .utf8)
        try "AGENT_SERVER_PANEL_URL=https://panel.example\n"
            .write(to: envURL, atomically: true, encoding: .utf8)

        XCTAssertEqual(
            try EnvFileStore.firstValue(
                forKey: "AGENT_SERVER_PANEL_URL",
                from: [localURL, envURL]
            ),
            "https://panel.example"
        )

        try "AGENT_SERVER_PANEL_URL=https://local.example\n"
            .write(to: localURL, atomically: true, encoding: .utf8)

        XCTAssertEqual(
            try EnvFileStore.firstValue(
                forKey: "AGENT_SERVER_PANEL_URL",
                from: [localURL, envURL]
            ),
            "https://local.example"
        )
    }

    func testLocalAPIAuthenticationUsesHeaderAndDoesNotExposeKeyInURL() throws {
        let url = tempURL()
        try "AGENT_SERVER_API_KEY=local-secret\n"
            .write(to: url, atomically: true, encoding: .utf8)
        let endpoint = URL(string: "http://127.0.0.1:47821/agents")!

        let request = try LocalAPIAuthentication.authenticatedRequest(
            URLRequest(url: endpoint),
            environmentURLs: [url],
            processEnvironment: [:]
        )

        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer local-secret")
        XCTAssertEqual(request.url, endpoint)
    }

    func testLocalAPIAuthenticationRejectsMissingKey() {
        let url = tempURL()
        let endpoint = URL(string: "http://127.0.0.1:47821/agents")!

        XCTAssertThrowsError(
            try LocalAPIAuthentication.authenticatedRequest(
                URLRequest(url: endpoint),
                environmentURLs: [url],
                processEnvironment: [:]
            )
        ) { error in
            XCTAssertEqual(error as? LocalAPIAuthenticationError, .missingAPIKey)
        }
    }

    func testLocalAPIAuthenticationPrefersProcessEnvironmentOverDotEnv() throws {
        let base = tempURL().deletingLastPathComponent()
        let envURL = base.appendingPathComponent(".env")
        try "AGENT_SERVER_API_KEY=base-file-key\n"
            .write(to: envURL, atomically: true, encoding: .utf8)
        let endpoint = URL(string: "http://127.0.0.1:47821/agents")!

        let fileRequest = try LocalAPIAuthentication.authenticatedRequest(
            URLRequest(url: endpoint),
            environmentURLs: [envURL],
            processEnvironment: [:]
        )
        let processRequest = try LocalAPIAuthentication.authenticatedRequest(
            URLRequest(url: endpoint),
            environmentURLs: [envURL],
            processEnvironment: ["AGENT_SERVER_API_KEY": "process-key"]
        )

        XCTAssertEqual(
            fileRequest.value(forHTTPHeaderField: "Authorization"),
            "Bearer base-file-key"
        )
        XCTAssertEqual(
            processRequest.value(forHTTPHeaderField: "Authorization"),
            "Bearer process-key"
        )
    }

    // MARK: - Round-trip preserving comments and order

    func testLoadSaveLoadPreservesCommentsAndOrdering() throws {
        let url = tempURL()
        let content = """
        # Panel credentials
        AGENT_SERVER_PANEL_URL=https://www.agentpanel.dev
        AGENT_SERVER_PANEL_API_KEY=ap_live_abcd1234

        # Telegram integration
        AGENT_SERVER_TELEGRAM_BOT_TOKEN=bot_token_value
        """
        try content.write(to: url, atomically: true, encoding: .utf8)

        let loaded = try EnvFileStore.load(from: url)
        try EnvFileStore.save(loaded, to: url)

        let rewritten = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(rewritten.contains("# Panel credentials"))
        XCTAssertTrue(rewritten.contains("# Telegram integration"))

        let first = rewritten.range(of: "AGENT_SERVER_PANEL_URL")!.lowerBound
        let second = rewritten.range(of: "AGENT_SERVER_PANEL_API_KEY")!.lowerBound
        let third = rewritten.range(of: "AGENT_SERVER_TELEGRAM_BOT_TOKEN")!.lowerBound
        XCTAssertLessThan(first, second)
        XCTAssertLessThan(second, third)

        let panelCommentIdx = rewritten.range(of: "# Panel credentials")!.lowerBound
        XCTAssertLessThan(panelCommentIdx, first)

        let telegramCommentIdx = rewritten.range(of: "# Telegram integration")!.lowerBound
        XCTAssertLessThan(telegramCommentIdx, third)
        XCTAssertGreaterThan(telegramCommentIdx, second)
    }

    func testSaveUpdatesExistingKeyValueInPlace() throws {
        let url = tempURL()
        let content = """
        # Panel
        AGENT_SERVER_PANEL_URL=https://old.example.com
        AGENT_SERVER_PANEL_API_KEY=old_key
        """
        try content.write(to: url, atomically: true, encoding: .utf8)

        var pairs = try EnvFileStore.load(from: url)
        pairs = pairs.map { pair in
            pair.key == "AGENT_SERVER_PANEL_URL"
                ? EnvPair(key: pair.key, value: "https://new.example.com", isSecret: pair.isSecret)
                : pair
        }
        try EnvFileStore.save(pairs, to: url)

        let rewritten = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(rewritten.contains("AGENT_SERVER_PANEL_URL=https://new.example.com"))
        XCTAssertFalse(rewritten.contains("https://old.example.com"))
        XCTAssertTrue(rewritten.contains("# Panel"))
    }

    // MARK: - Validation

    func testSaveRejectsInvalidKey() {
        let url = tempURL()
        let pairs = [EnvPair(key: "lowercase", value: "x", isSecret: false)]
        XCTAssertThrowsError(try EnvFileStore.save(pairs, to: url)) { error in
            guard case EnvFileStoreError.invalidKey(let key) = error else {
                XCTFail("expected invalidKey error, got \(error)")
                return
            }
            XCTAssertEqual(key, "lowercase")
        }
    }

    func testSaveRejectsKeyWithLeadingDigit() {
        let url = tempURL()
        let pairs = [EnvPair(key: "1BAD", value: "x", isSecret: false)]
        XCTAssertThrowsError(try EnvFileStore.save(pairs, to: url))
    }

    func testIsValidKeyMatchesExpectedPattern() {
        XCTAssertTrue(EnvFileStore.isValidKey("FOO"))
        XCTAssertTrue(EnvFileStore.isValidKey("FOO_BAR_1"))
        XCTAssertTrue(EnvFileStore.isValidKey("A"))
        XCTAssertFalse(EnvFileStore.isValidKey(""))
        XCTAssertFalse(EnvFileStore.isValidKey("lower"))
        XCTAssertFalse(EnvFileStore.isValidKey("1BAD"))
        XCTAssertFalse(EnvFileStore.isValidKey("HAS SPACE"))
    }

    // MARK: - Appends new keys at the end

    func testSaveAppendsNewKeysPreservingExisting() throws {
        let url = tempURL()
        try "# Existing\nFOO=bar\n".write(to: url, atomically: true, encoding: .utf8)

        var pairs = try EnvFileStore.load(from: url)
        pairs.append(EnvPair(key: "NEW_KEY", value: "new_value", isSecret: true))
        try EnvFileStore.save(pairs, to: url)

        let rewritten = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(rewritten.contains("# Existing"))
        XCTAssertTrue(rewritten.contains("FOO=bar"))
        XCTAssertTrue(rewritten.contains("NEW_KEY=new_value"))

        let fooIdx = rewritten.range(of: "FOO=bar")!.lowerBound
        let newIdx = rewritten.range(of: "NEW_KEY=new_value")!.lowerBound
        XCTAssertLessThan(fooIdx, newIdx)
    }

    // MARK: - Atomic write

    func testSaveIsAtomicAndDoesNotLeaveTempFile() throws {
        let url = tempURL()
        let pairs = [EnvPair(key: "FOO", value: "bar", isSecret: false)]
        try EnvFileStore.save(pairs, to: url)

        let parent = url.deletingLastPathComponent()
        let contents = try FileManager.default.contentsOfDirectory(atPath: parent.path)
        XCTAssertTrue(contents.contains(url.lastPathComponent))
        for item in contents {
            XCTAssertFalse(item.hasSuffix(".tmp"), "tmp file left behind: \(item)")
        }
    }
}
