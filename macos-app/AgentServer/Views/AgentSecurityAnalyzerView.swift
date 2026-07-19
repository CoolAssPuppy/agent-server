import SwiftUI
import NerdsUI

struct AgentSecurityActions {
    let scan: () async -> Result<SecurityScanPresentation, ConsumerFlowFailure>
    let reviewFix: (String) async -> Result<GuidancePatchPreview, ConsumerFlowFailure>
    let applyFix: (String) async -> Result<SecurityScanPresentation, ConsumerFlowFailure>
    let ignore: (String, String?) async -> Result<SecurityScanPresentation, ConsumerFlowFailure>
    let markReviewed: () async -> Result<SecurityScanPresentation, ConsumerFlowFailure>
}

private struct ReviewedSecurityFix: Identifiable {
    let finding: SecurityFindingPresentation
    let preview: GuidancePatchPreview
    var id: String { finding.id }
}

struct AgentSecurityAnalyzerView: View {
    let agentName: String
    let actions: AgentSecurityActions
    var showsHeading = true

    @Environment(\.nTheme) private var theme
    @State private var scan: SecurityScanPresentation?
    @State private var failure: ConsumerFlowFailure?
    @State private var isLoading = false
    @State private var reviewedFix: ReviewedSecurityFix?
    @State private var findingToIgnore: SecurityFindingPresentation?
    @State private var ignoreReason = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.lg) {
                header
                content
            }
            .frame(maxWidth: 760)
            .padding(NSpacing.xl)
        }
        .background(theme.tokens.background)
        .task { if scan == nil { await runScan() } }
        .sheet(item: $reviewedFix, content: fixReviewSheet)
        .sheet(item: $findingToIgnore) { finding in
            ignoreSheet(finding)
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            if showsHeading {
                ConsumerFlowHeader(
                    title: "Security check",
                    explanation: explanation
                )
            } else {
                Text(explanation)
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            Spacer()
            Button("Check again") { Task { await runScan() } }
                .disabled(isLoading)
        }
    }

    private var explanation: String {
        "See what \(agentName) can access and what could happen if something goes wrong."
    }

    @ViewBuilder
    private var content: some View {
        if isLoading {
            ConsumerProgressView(title: "Checking this agent", message: "Reviewing its access, connections, schedule, and instructions.")
        } else if let failure {
            ConsumerFlowFailureView(failure: failure, retry: failure.canRetry ? { Task { await runScan() } } : nil)
        } else if let scan {
            scanContent(scan)
        }
    }

    private func scanContent(_ scan: SecurityScanPresentation) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            ConsumerSection("Summary") {
                HStack {
                    ConsumerRiskLabel(risk: scan.overallRisk)
                    Text(scan.summaryText)
                        .font(NTypography.bodyMedium)
                    Spacer()
                }
                if scan.isStale {
                    Label("This agent changed since its last review.", systemImage: "clock.badge.exclamationmark")
                        .foregroundStyle(theme.tokens.warning)
                }
            }
            if scan.findings.isEmpty {
                ConsumerSection("No issues found") {
                    Text("This check cannot prove an agent is safe. Review its access again whenever its job changes.")
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
            } else {
                ForEach(scan.groupedFindings, id: \.severity) { group in
                    VStack(alignment: .leading, spacing: NSpacing.sm) {
                        Text(group.title)
                            .font(NTypography.headlineSmall)
                        ForEach(group.findings) { finding in
                            SecurityFindingCard(
                                finding: finding,
                                reviewFix: finding.canFix ? { Task { await reviewFix(finding) } } : nil,
                                ignore: { findingToIgnore = finding }
                            )
                        }
                    }
                }
            }
            Button("Mark reviewed") { Task { await markReviewed() } }
                .buttonStyle(.borderedProminent)
                .disabled(scan.isStale || scan.findings.contains(where: { $0.severity == .critical }))
                .accessibilityHint("Available after critical findings are resolved and the scan is current")
        }
    }

    private func ignoreSheet(_ finding: SecurityFindingPresentation) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            ConsumerFlowHeader(title: "Ignore this warning?", explanation: "The warning will remain acknowledged until the agent changes.")
            Text(finding.title)
                .font(NTypography.bodyMedium)
            TextField("Optional reason", text: $ignoreReason)
                .textFieldStyle(.roundedBorder)
            HStack {
                Button("Cancel") { findingToIgnore = nil }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Ignore warning") { Task { await ignore(finding) } }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(NSpacing.xl)
        .frame(width: 480)
    }

    private func runScan() async {
        isLoading = true
        failure = nil
        switch await actions.scan() {
        case .success(let result): scan = result
        case .failure(let error): failure = error
        }
        isLoading = false
    }

    private func applyFix(_ finding: SecurityFindingPresentation) async {
        reviewedFix = nil
        isLoading = true
        switch await actions.applyFix(finding.id) {
        case .success(let result): scan = result
        case .failure(let error): failure = error
        }
        isLoading = false
    }

    private func reviewFix(_ finding: SecurityFindingPresentation) async {
        isLoading = true
        switch await actions.reviewFix(finding.id) {
        case .success(let preview): reviewedFix = ReviewedSecurityFix(finding: finding, preview: preview)
        case .failure(let error): failure = error
        }
        isLoading = false
    }

    private func fixReviewSheet(_ review: ReviewedSecurityFix) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            ConsumerFlowHeader(title: "Review changes", explanation: review.finding.recommendation)
            ConsumerSection("What will change") {
                ForEach(review.preview.changes, id: \.field) { change in
                    Label(change.summary, systemImage: "checkmark.circle")
                }
            }
            DisclosureGroup("Advanced configuration") {
                Text(review.preview.advancedChanges.prettyPrinted)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
            }
            HStack {
                Button("Cancel") { reviewedFix = nil }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Apply reviewed fix") { Task { await applyFix(review.finding) } }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(NSpacing.xl)
        .frame(width: 560)
    }

    private func ignore(_ finding: SecurityFindingPresentation) async {
        let reason = ignoreReason.trimmingCharacters(in: .whitespacesAndNewlines)
        findingToIgnore = nil
        ignoreReason = ""
        switch await actions.ignore(finding.id, reason.isEmpty ? nil : reason) {
        case .success(let result): scan = result
        case .failure(let error): failure = error
        }
    }

    private func markReviewed() async {
        switch await actions.markReviewed() {
        case .success(let updated): scan = updated
        case .failure(let error): failure = error
        }
    }
}
