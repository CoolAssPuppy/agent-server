import AgentServerDesignSystem
import SwiftUI

struct AgentDetailHeader: View {
    let name: String
    let description: String?
    let schedule: String?
    let nextRun: String?
    let run: AgentDetailHeaderRunPresentation
    let security: AgentDetailSecurityIndicatorPresentation
    let onClose: () -> Void
    let onRun: () -> Void
    let onSecurity: () -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.md) {
            closeButton
            identity
            Spacer()
            runButton
            securityButton
        }
        .padding(.horizontal, NSpacing.xl)
        .padding(.vertical, NSpacing.md)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "chevron.left")
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .keyboardShortcut("w", modifiers: .command)
        .help("Close drawer (⌘W)")
    }

    private var identity: some View {
        VStack(alignment: .leading, spacing: NSpacing.xs) {
            Text(name)
                .font(NTypography.headlineMedium)
                .foregroundStyle(theme.tokens.foreground)
            if let description, !description.isEmpty {
                Text(description)
                    .font(NTypography.caption)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .lineLimit(2)
            }
            if let schedule {
                HStack(spacing: NSpacing.xs) {
                    Image(systemName: "clock")
                        .font(.system(size: 10))
                        .accessibilityHidden(true)
                    Text(schedule)
                    if let nextRun { Text("· next \(nextRun)") }
                }
                .font(NTypography.captionSmall)
                .foregroundStyle(theme.tokens.mutedForeground)
            }
        }
    }

    private var runButton: some View {
        Button(action: onRun) {
            Image(systemName: run.symbol)
                .font(NTypography.bodyMedium)
                .foregroundStyle(run.tone == .highlight
                    ? theme.tokens.primary
                    : theme.tokens.mutedForeground)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(run.isDisabled)
        .help(run.help)
        .accessibilityLabel(run.help)
        .accessibilityIdentifier(ConsumerFlowAccessibility.agentDetailRun)
    }

    private var securityButton: some View {
        Button(action: onSecurity) {
            Image(systemName: security.symbol)
                .font(NTypography.bodyMedium)
                .foregroundStyle(securityColor)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(security.help)
        .accessibilityLabel("Security: \(security.help)")
        .accessibilityIdentifier(ConsumerFlowAccessibility.agentDetailSecurity)
    }

    private var securityColor: Color {
        switch security.tone {
        case .good: theme.tokens.success
        case .warning: theme.tokens.warning
        case .critical: theme.tokens.destructive
        }
    }
}

struct AgentDetailTabBar: View {
    let selectedTab: AgentDetailTab
    let onSelect: (AgentDetailTab) -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(spacing: NSpacing.xxs) {
            ForEach(AgentDetailTab.allCases, id: \.self) { tab in
                Button {
                    onSelect(tab)
                } label: {
                    Text(tab.title)
                        .font(NTypography.caption)
                        .fontWeight(selectedTab == tab ? .semibold : .regular)
                        .foregroundStyle(selectedTab == tab
                            ? theme.tokens.primaryForeground
                            : theme.tokens.mutedForeground)
                        .padding(.horizontal, NSpacing.md)
                        .padding(.vertical, NSpacing.xs)
                        .frame(maxWidth: .infinity)
                        .background(selectedTab == tab ? theme.tokens.primary : Color.clear,
                                    in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(tab.accessibilityIdentifier)
                .accessibilityAddTraits(selectedTab == tab ? .isSelected : [])
            }
        }
        .padding(NSpacing.xxs)
        .background(theme.tokens.muted.opacity(0.55), in: Capsule())
        .padding(.horizontal, NSpacing.xl)
        .padding(.vertical, NSpacing.sm)
    }
}
