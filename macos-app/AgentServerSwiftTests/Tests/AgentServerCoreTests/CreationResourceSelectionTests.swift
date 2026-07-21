import XCTest
@testable import AgentServerCore

final class CreationResourceSelectionTests: XCTestCase {
    func testFolderSelectionRequiresExactlyOneDirectory() {
        let file = CreationResourceCandidate(path: "/tmp/report.txt", isDirectory: false)
        let folder = CreationResourceCandidate(path: "/tmp/reports", isDirectory: true)

        XCTAssertEqual(CreationResourceSelection.folderPath(from: [file]), .failure(.folderRequired))
        XCTAssertEqual(CreationResourceSelection.folderPath(from: [folder]), .success("/tmp/reports"))
    }

    func testFileGrantsAreDeduplicatedAndDefaultToReadOnly() {
        let file = CreationResourceCandidate(path: "/tmp/report.txt", isDirectory: false)
        let folder = CreationResourceCandidate(path: "/tmp/reports", isDirectory: true)
        var selection = CreationResourceSelection()

        selection.add([file, folder, file])

        XCTAssertEqual(selection.grants, [
            CreationFileGrant(path: file.path, kind: .file, access: .readOnly),
            CreationFileGrant(path: folder.path, kind: .folder, access: .readOnly),
        ])
    }

    func testGrantAccessCanChangeAndGrantCanBeRemoved() {
        let folder = CreationResourceCandidate(path: "/tmp/reports", isDirectory: true)
        var selection = CreationResourceSelection()
        selection.add([folder])

        selection.setAccess(.readWrite, for: folder.path)
        XCTAssertEqual(selection.grants.first?.access, .readWrite)

        selection.remove(path: folder.path)
        XCTAssertTrue(selection.grants.isEmpty)
    }
}
