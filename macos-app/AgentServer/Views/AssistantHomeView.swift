import SwiftUI
import AgentServerDesignSystem

struct AssistantHomeView: View {
    let presentation: AssistantHomePresentation
    let showsIdentity: Bool
    let isPerformingAction: Bool
    let onPrimaryAction: (PresentationAction) -> Void
    let onSecondaryAction: (PresentationAction) -> Void
    let onOpenRun: (AssistantRecentOutcome) -> Void

    @Environment(\.nTheme) private var theme
    @State private var isAdvancedExpanded: Bool

    init(
        presentation: AssistantHomePresentation,
        showsIdentity: Bool = true,
        isPerformingAction: Bool = false,
        onPrimaryAction: @escaping (PresentationAction) -> Void,
        onSecondaryAction: @escaping (PresentationAction) -> Void,
        onOpenRun: @escaping (AssistantRecentOutcome) -> Void
    ) {
        self.presentation = presentation
        self.showsIdentity = showsIdentity
        self.isPerformingAction = isPerformingAction
        self.onPrimaryAction = onPrimaryAction
        self.onSecondaryAction = onSecondaryAction
        self.onOpenRun = onOpenRun
        _isAdvancedExpanded = State(initialValue: presentation.isAdvancedExpandedByDefault)
    }

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: NSpacing.xl) {
                if showsIdentity { identity }
                statusAndAction
                readiness
                scheduleAndDestination
                access
                connections
                recentOutcomes
                secondaryActions
                if let advanced = presentation.contract.advanced {
                    advancedDetails(advanced)
                }
            }
            .padding(NSpacing.xl)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .background(theme.tokens.background)
        .accessibilityIdentifier("assistantHome.screen")
    }

    private var identity: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            Text(presentation.contract.assistant.displayName)
                .font(NTypography.displayMedium)
                .foregroundStyle(theme.tokens.foreground)
                .accessibilityAddTraits(.isHeader)
            Text(presentation.contract.purpose.text)
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var statusAndAction: some View {
        HStack(alignment: .center, spacing: NSpacing.lg) {
            Label(presentation.health.label, systemImage: presentation.health.symbol)
                .font(NTypography.headlineMedium)
                .foregroundStyle(presentation.health.tone.color(theme.tokens))
            Text("This Mac")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
            Spacer()
            if let action = presentation.primaryAction {
                Button {
                    onPrimaryAction(action)
                } label: {
                    HStack(spacing: NSpacing.xs) {
                        if isPerformingAction { ProgressView().controlSize(.small) }
                        Text(action.label)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isPerformingAction)
                .accessibilityIdentifier("assistantHome.primaryAction")
            }
        }
        .padding(NSpacing.lg)
        .background(theme.tokens.card)
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
    }

    private var readiness: some View {
        AssistantHomeReadinessSection(presentation: presentation)
    }

    private var scheduleAndDestination: some View {
        HStack(alignment: .top, spacing: NSpacing.md) {
            AssistantHomeFactCard(
                title: "Schedule",
                symbol: "calendar",
                text: presentation.scheduleText,
                detail: presentation.contract.schedule.nextRunAt.map {
                    "Next run \($0.formatted(date: .abbreviated, time: .shortened))"
                }
            )
            AssistantHomeFactCard(
                title: "Results",
                symbol: "arrow.down.doc",
                text: presentation.destinationText ?? "No result destination is declared.",
                detail: nil
            )
        }
    }

    private var access: some View {
        AssistantHomeListSection(
            title: "Access",
            emptyText: "No file or command access is declared.",
            isEmpty: presentation.permissionLines.isEmpty
        ) {
            ForEach(Array(presentation.permissionLines.enumerated()), id: \.offset) { _, line in
                Label(line.text, systemImage: line.effect.symbol)
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.foreground)
            }
        }
    }

    private var connections: some View {
        AssistantHomeListSection(
            title: "Connections",
            emptyText: "This assistant does not use a connection.",
            isEmpty: presentation.contract.connections.isEmpty
        ) {
            ForEach(presentation.contract.connections, id: \.id) { connection in
                AssistantHomeConnectionRow(connection: connection)
            }
        }
    }

    private var recentOutcomes: some View {
        AssistantHomeListSection(
            title: "Recent outcomes",
            emptyText: "This assistant has not run yet.",
            isEmpty: presentation.recentOutcomes.isEmpty
        ) {
            ForEach(presentation.recentOutcomes, id: \.runId) { outcome in
                Button { onOpenRun(outcome) } label: {
                    AssistantHomeOutcomeRow(outcome: outcome)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("assistantHome.outcome.\(outcome.runId)")
            }
        }
    }

    @ViewBuilder
    private var secondaryActions: some View {
        let actions = presentation.contract.secondaryActions.filter { $0.kind != .unknown }
        if !actions.isEmpty {
            HStack(spacing: NSpacing.sm) {
                ForEach(Array(actions.enumerated()), id: \.offset) { _, action in
                    Button(action.label) { onSecondaryAction(action) }
                        .buttonStyle(.bordered)
                        .disabled(isPerformingAction)
                }
            }
        }
    }

    private func advancedDetails(_ details: AssistantHomeAdvanced) -> some View {
        DisclosureGroup("Advanced details", isExpanded: $isAdvancedExpanded) {
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                if let schedule = details.scheduleExpression {
                    advancedRow(label: "Schedule expression", values: [schedule])
                }
                advancedRow(label: "AI engine", values: [details.executor])
                if let model = details.model {
                    advancedRow(label: "Model", values: [model])
                }
                if let permissionMode = details.permissionMode {
                    advancedRow(label: "Permission mode", values: [permissionMode])
                }
                advancedRow(label: "Allow rules", values: details.permissionRules.allow)
                advancedRow(label: "Deny rules", values: details.permissionRules.deny)
                advancedRow(label: "Connection IDs", values: details.connectionIds)
            }
            .padding(.top, NSpacing.sm)
        }
        .font(NTypography.labelMedium)
        .foregroundStyle(theme.tokens.mutedForeground)
        .accessibilityIdentifier("assistantHome.advanced")
        .accessibilityValue(isAdvancedExpanded ? "Expanded" : "Collapsed")
    }

    @ViewBuilder
    private func advancedRow(label: String, values: [String]) -> some View {
        if !values.isEmpty {
            VStack(alignment: .leading, spacing: NSpacing.xxs) {
                Text(label)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                ForEach(Array(values.enumerated()), id: \.offset) { _, value in
                    Text(value)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(theme.tokens.foreground)
                        .textSelection(.enabled)
                }
            }
        }
    }
}
