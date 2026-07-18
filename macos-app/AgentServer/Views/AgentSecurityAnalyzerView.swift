import SwiftUI
import NerdsUI

struct AgentSecurityActions {
    let scan: () async -> Result<SecurityScanPresentation, ConsumerFlowFailure>
    let applyFix: (String) async -> Result<SecurityScanPresentation, ConsumerFlowFailure>
    let ignore: (String, String?) async -> Result<SecurityScanPresentation, ConsumerFlowFailure>
    let markReviewed: () async -> Result<SecurityScanPresentation, ConsumerFlowFailure>
}

struct AgentSecurityAnalyzerView: View {
    let agentName: String
    let actions: AgentSecurityActions

    @Environment(\.nTheme) private var theme
    @State private var scan: SecurityScanPresentation?
    @State private var failure: ConsumerFlowFailure?
    @State private var isLoading = false
    @State private var findingToFix: SecurityFindingPresentation?
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
        .confirmationDialog(
            "Apply this safer setting?",
            isPresented: Binding(
                get: { findingToFix != nil },
                set: { if !$0 { findingToFix = nil } }
            ),
            presenting: findingToFix
        ) { finding in
            Button("Apply reviewed fix") { Task { await applyFix(finding) } }
            Button("Cancel", role: .cancel) {}
        } message: { finding in
            Text("\(finding.recommendation) \(finding.functionalityImpact)")
        }
        .sheet(item: $findingToIgnore) { finding in
            ignoreSheet(finding)
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            ConsumerFlowHeader(
                title: "Security check",
                explanation: "See what \(agentName) can access and what could happen if something goes wrong."
            )
            Button("Check again") { Task { await runScan() } }
                .disabled(isLoading)
        }
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
                                reviewFix: finding.canFix ? { findingToFix = finding } : nil,
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
        isLoading = true
        switch await actions.applyFix(finding.id) {
        case .success(let result): scan = result
        case .failure(let error): failure = error
        }
        isLoading = false
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
