import XCTest
@testable import AgentServerCore

final class SecurityReviewActionPresentationTests: XCTestCase {
    func testHighRiskCurrentScanCanApproveEvenWhenThePriorReviewIsStale() {
        let scan = SecurityScanPresentation(
            findings: [finding(id: "external-write", severity: .high)],
            reviewedAt: nil,
            isStale: true
        )

        XCTAssertEqual(scan.reviewAction, .approveAutomaticRuns)
    }

    func testApprovedHighRiskScanShowsTheDurableApprovalDate() {
        let reviewedAt = Date(timeIntervalSince1970: 1_721_299_200)
        let scan = SecurityScanPresentation(
            findings: [finding(id: "external-write", severity: .high)],
            reviewedAt: reviewedAt,
            isStale: false
        )

        XCTAssertEqual(scan.reviewAction, .approvedForAutomaticRuns(reviewedAt))
    }

    func testLowAndNeedsReviewScansDoNotOfferUnneededApproval() {
        let low = SecurityScanPresentation(findings: [], reviewedAt: nil, isStale: true)
        let needsReview = SecurityScanPresentation(
            findings: [finding(id: "ambiguous-input", severity: .needsReview)],
            reviewedAt: nil,
            isStale: true
        )

        XCTAssertEqual(low.reviewAction, .notRequired)
        XCTAssertEqual(needsReview.reviewAction, .notRequired)
    }

    func testCriticalFindingsCannotBeApprovedAway() {
        let scan = SecurityScanPresentation(
            findings: [finding(id: "embedded-secret", severity: .critical)],
            reviewedAt: nil,
            isStale: true
        )

        XCTAssertEqual(scan.reviewAction, .blockedByCriticalFindings)
    }

    func testSingleRiskGroupDoesNotRepeatTheSummaryRiskHeading() {
        let singleGroup = SecurityScanPresentation(
            findings: [
                finding(id: "first", severity: .needsReview),
                finding(id: "second", severity: .needsReview),
            ],
            reviewedAt: nil,
            isStale: true
        )
        let mixedGroups = SecurityScanPresentation(
            findings: [
                finding(id: "first", severity: .needsReview),
                finding(id: "second", severity: .high),
            ],
            reviewedAt: nil,
            isStale: true
        )

        XCTAssertFalse(singleGroup.showsFindingGroupHeadings)
        XCTAssertTrue(mixedGroups.showsFindingGroupHeadings)
    }

    private func finding(id: String, severity: ConsumerRiskLevel) -> SecurityFindingPresentation {
        SecurityFindingPresentation(
            id: id,
            severity: severity,
            title: "Finding \(id)",
            whyItMatters: "It matters.",
            potentialImpact: "Something could happen.",
            trigger: "A trigger.",
            recommendation: "Make a change.",
            functionalityImpact: "The task still works.",
            canFix: true
        )
    }
}
