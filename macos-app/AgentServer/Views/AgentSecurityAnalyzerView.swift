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
    @Binding var selectedFindingId: String?

    @Environment(\.nTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var scan: SecurityScanPresentation?
    @State private var failure: ConsumerFlowFailure?
    @State private var isLoading = false
    @State private var reviewedFix: ReviewedSecurityFix?
    @State private var findingToIgnore: SecurityFindingPresentation?
    @State private var ignoreReason = ""

    init(
        agentName: String,
        actions: AgentSecurityActions,
        showsHeading: Bool = true,
        selectedFindingId: Binding<String?> = .constant(nil)
    ) {
        self.agentName = agentName
        self.actions = actions
        self.showsHeading = showsHeading
        _selectedFindingId = selectedFindingId
    }

    var body: some View {
        HStack(spacing: 0) {
            analysisPanel
                .frame(width: selectedFinding == nil ? nil : 400)
                .frame(maxWidth: selectedFinding == nil ? .infinity : nil)
            if let selectedFinding {
                Divider().opacity(0.35)
                findingPanel(selectedFinding)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(
            reduceMotion ? nil : .easeInOut(duration: 0.22),
            value: selectedFindingId
        )
        .task { if scan == nil { await runScan() } }
        .sheet(item: $reviewedFix, content: fixReviewSheet)
        .sheet(item: $findingToIgnore, content: ignoreSheet)
    }

    private var analysisPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: NSpacing.xl) {
                if showsHeading {
                    Text("Security check")
                        .font(NTypography.headlineLarge)
                }
                Text(explanation)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                content
            }
            .padding(.horizontal, NSpacing.xxl)
            .padding(.vertical, NSpacing.xl)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var explanation: String {
        "See what \(agentName) can access and what could happen if something goes wrong."
    }

    @ViewBuilder
    private var content: some View {
        if isLoading {
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                ProgressView()
                Text("Checking this agent")
                    .font(.system(size: 13, weight: .medium))
                Text("Reviewing access, connections, schedule, and instructions.")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
            }
            .frame(maxWidth: .infinity, minHeight: 180, alignment: .center)
        } else if let failure {
            ConsumerFlowFailureView(
                failure: failure,
                retry: failure.canRetry ? { Task { await runScan() } } : nil
            )
        } else if let scan {
            scanContent(scan)
        }
    }

    private func scanContent(_ scan: SecurityScanPresentation) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.xl) {
            summary(scan)
            if scan.findings.isEmpty {
                VStack(alignment: .leading, spacing: NSpacing.xs) {
                    SecuritySectionLabel(title: "Result")
                    Text("No issues found")
                        .font(.system(size: 13, weight: .medium))
                    Text("This check cannot prove an agent is safe. Review its access again whenever its job changes.")
                        .font(NTypography.caption)
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
            } else {
                ForEach(scan.groupedFindings, id: \.severity) { group in
                    findingGroup(group)
                }
            }
            Button("Mark reviewed") { Task { await markReviewed() } }
                .buttonStyle(.borderedProminent)
                .disabled(scan.isStale || scan.findings.contains(where: { $0.severity == .critical }))
                .accessibilityHint("Available after critical findings are resolved and the scan is current")
        }
    }

    private func summary(_ scan: SecurityScanPresentation) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            SecuritySectionLabel(title: "Summary")
            HStack(alignment: .firstTextBaseline, spacing: NSpacing.md) {
                SecurityRiskStatus(risk: scan.overallRisk, isProminent: true)
                Text(scan.summaryText)
                    .font(.system(size: 13))
            }
            if scan.isStale {
                Label("This agent changed since its last review.", systemImage: "clock.badge.exclamationmark")
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.warning)
            }
        }
    }

    private func findingGroup(_ group: SecurityFindingGroup) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            SecuritySectionLabel(title: group.title)
            SecurityGroupedSurface {
                ForEach(Array(group.findings.enumerated()), id: \.element.id) { index, finding in
                    if index > 0 { Divider().opacity(0.25) }
                    SecurityFindingRow(
                        finding: finding,
                        isSelected: selectedFindingId == finding.id,
                        onSelect: { selectedFindingId = finding.id }
                    )
                }
            }
        }
    }

    private func findingPanel(_ finding: SecurityFindingPresentation) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: NSpacing.sm) {
                Button { selectedFindingId = nil } label: {
                    Image(systemName: "chevron.left")
                        .frame(width: 24, height: 24)
                }
                .buttonStyle(.plain)
                .help("Back to findings")
                .accessibilityLabel("Back to findings")
                Text("Finding details")
                    .font(.system(size: 13, weight: .semibold))
                Spacer()
            }
            .padding(.horizontal, NSpacing.xxl)
            .padding(.vertical, NSpacing.md)
            Divider().opacity(0.3)
            ScrollView {
                SecurityFindingDetail(
                    finding: finding,
                    reviewFix: finding.canFix ? { Task { await reviewFix(finding) } } : nil,
                    ignore: { findingToIgnore = finding }
                )
                .padding(NSpacing.xxl)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var selectedFinding: SecurityFindingPresentation? {
        guard let selectedFindingId else { return nil }
        return scan?.findings.first { $0.id == selectedFindingId }
    }

    private func ignoreSheet(_ finding: SecurityFindingPresentation) -> some View {
        VStack(alignment: .leading, spacing: NSpacing.lg) {
            ConsumerFlowHeader(
                title: "Ignore this warning?",
                explanation: "The warning stays acknowledged until the agent changes."
            )
            Text(finding.title)
                .font(.system(size: 13, weight: .medium))
            TextField("Optional reason", text: $ignoreReason)
                .textFieldStyle(.roundedBorder)
            HStack {
                Spacer()
                Button("Cancel") { findingToIgnore = nil }
                    .keyboardShortcut(.cancelAction)
                Button("Ignore warning") { Task { await ignore(finding) } }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(NSpacing.xxl)
        .frame(width: 480)
    }

    private func runScan() async {
        isLoading = true
        failure = nil
        switch await actions.scan() {
        case .success(let result):
            scan = result
            if let selectedFindingId, !result.findings.contains(where: { $0.id == selectedFindingId }) {
                self.selectedFindingId = nil
            }
        case .failure(let error): failure = error
        }
        isLoading = false
    }

    private func applyFix(_ finding: SecurityFindingPresentation) async {
        reviewedFix = nil
        isLoading = true
        switch await actions.applyFix(finding.id) {
        case .success(let result):
            scan = result
            selectedFindingId = nil
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
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                SecuritySectionLabel(title: "What will change")
                ForEach(review.preview.changes, id: \.field) { change in
                    Label(change.summary, systemImage: "checkmark.circle")
                        .font(.system(size: 13))
                }
            }
            DisclosureGroup("Advanced configuration") {
                Text(review.preview.advancedChanges.prettyPrinted)
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(.top, NSpacing.xs)
            }
            HStack {
                Spacer()
                Button("Cancel") { reviewedFix = nil }
                    .keyboardShortcut(.cancelAction)
                Button("Apply reviewed fix") { Task { await applyFix(review.finding) } }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(NSpacing.xxl)
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
