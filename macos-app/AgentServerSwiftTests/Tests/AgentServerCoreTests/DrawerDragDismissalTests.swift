import XCTest
import CoreGraphics
@testable import AgentServerCore

/// Behavior: a drawer drag should dismiss when the user has pulled past the
/// threshold, and snap back otherwise. This tests the pure helper the
/// SwiftUI DragGesture.onEnded callback relies on.
final class DrawerDragDismissalTests: XCTestCase {

    private let threshold: CGFloat = 80

    // MARK: - Leading drawer (drag LEFT to close)

    func testLeadingDrawerDragBelowThresholdSnapsBack() {
        XCTAssertFalse(shouldDismissOnRelease(translation: -40, threshold: threshold))
        XCTAssertFalse(shouldDismissOnRelease(translation: -79.9, threshold: threshold))
        XCTAssertFalse(shouldDismissOnRelease(translation: 0, threshold: threshold))
    }

    func testLeadingDrawerDragAtOrPastThresholdDismisses() {
        XCTAssertTrue(shouldDismissOnRelease(translation: -80, threshold: threshold))
        XCTAssertTrue(shouldDismissOnRelease(translation: -200, threshold: threshold))
    }

    func testLeadingDrawerIgnoresRightwardDrag() {
        // Pulling the drawer to the right should never dismiss it.
        XCTAssertFalse(shouldDismissOnRelease(translation: 500, threshold: threshold))
    }

    // MARK: - Top drawer (drag DOWN to close)

    func testTopDrawerDragBelowThresholdSnapsBack() {
        XCTAssertFalse(shouldDismissOnRelease(translation: 40, threshold: threshold, axis: .vertical))
        XCTAssertFalse(shouldDismissOnRelease(translation: 79.9, threshold: threshold, axis: .vertical))
    }

    func testTopDrawerDragPastThresholdDismisses() {
        XCTAssertTrue(shouldDismissOnRelease(translation: 80, threshold: threshold, axis: .vertical))
        XCTAssertTrue(shouldDismissOnRelease(translation: 320, threshold: threshold, axis: .vertical))
    }

    func testTopDrawerIgnoresUpwardDrag() {
        XCTAssertFalse(shouldDismissOnRelease(translation: -100, threshold: threshold, axis: .vertical))
    }
}
