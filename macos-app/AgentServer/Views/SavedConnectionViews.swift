import SwiftUI
import NerdsUI

struct SavedConnectionRow: View {
    let presentation: ConnectionProfilePresentation
    let isSelected: Bool
    let onSelect: () -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: NSpacing.md) {
                Image(systemName: "point.3.connected.trianglepath.dotted")
                    .frame(width: 24)
                    .foregroundStyle(theme.tokens.foreground)
                    .accessibilityHidden(true)
                identity
                Spacer(minLength: NSpacing.md)
                status
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, NSpacing.md)
            .padding(.vertical, NSpacing.md)
            .contentShape(Rectangle())
            .background(isSelected ? theme.tokens.accent.opacity(0.08) : Color.clear)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            "\(presentation.name), \(presentation.rowSummary), \(presentation.statusTitle)"
        )
        .accessibilityHint("Shows connection details")
    }

    private var identity: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(presentation.name)
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.foreground)
            Text(presentation.rowSummary)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .lineLimit(1)
        }
    }

    private var status: some View {
        Label(
            presentation.statusTitle,
            systemImage: presentation.status == .ready
                ? "checkmark.circle.fill"
                : "exclamationmark.circle"
        )
        .font(NTypography.caption)
        .foregroundStyle(
            presentation.status == .ready ? theme.tokens.success : theme.tokens.warning
        )
    }
}

struct SavedConnectionDetailView: View {
    let presentation: ConnectionProfilePresentation
    let onBack: () -> Void
    let onModifyCredentials: () -> Void

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            detailHeader
            Divider().opacity(0.3)
            ScrollView {
                VStack(alignment: .leading, spacing: NSpacing.xl) {
                    readinessCard
                    connectionCard
                    credentialCard
                    technicalDetails
                }
                .padding(NSpacing.xl)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("connections.detail")
    }

    private var detailHeader: some View {
        HStack(spacing: NSpacing.sm) {
            Button(action: onBack) {
                Label("All connections", systemImage: "chevron.left")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Back to all connections")
            Spacer()
        }
        .padding(.horizontal, NSpacing.xl)
        .padding(.vertical, NSpacing.md)
    }

    private var readinessCard: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Text(presentation.name)
                .font(NTypography.headlineMedium)
                .foregroundStyle(theme.tokens.foreground)
                .textSelection(.enabled)
            Label(
                presentation.statusTitle,
                systemImage: presentation.status == .ready
                    ? "checkmark.circle.fill"
                    : "exclamationmark.circle"
            )
            .font(NTypography.bodyMedium)
            .foregroundStyle(
                presentation.status == .ready ? theme.tokens.success : theme.tokens.warning
            )
            Text(presentation.statusExplanation)
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
        }
        .connectionDetailCard()
    }

    private var connectionCard: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Text("Connection")
                .font(NTypography.bodyMedium)
            detailRow("Method", presentation.connectionMethod)
            detailRow("Address", presentation.location, usesMonospacedText: true)
        }
        .connectionDetailCard()
    }

    private var credentialCard: some View {
        VStack(alignment: .leading, spacing: NSpacing.md) {
            HStack {
                Text("Credentials")
                    .font(NTypography.bodyMedium)
                Spacer()
                Button("Modify credentials", action: onModifyCredentials)
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("connections.modifyCredentials")
            }
            ForEach(presentation.credentialReferences, id: \.self) { reference in
                Label(reference, systemImage: "key")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .textSelection(.enabled)
            }
            Text("Secret values stay in the selected Agent Server folder and are never shown here.")
                .font(NTypography.caption)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
        }
        .connectionDetailCard()
    }

    private var technicalDetails: some View {
        DisclosureGroup("Advanced details") {
            VStack(alignment: .leading, spacing: NSpacing.sm) {
                detailRow("Transport", presentation.connectionMethod)
                detailRow("Credential references", presentation.credentialSummary)
            }
            .padding(.top, NSpacing.sm)
        }
        .font(NTypography.bodyMedium)
    }

    private func detailRow(
        _ label: String,
        _ value: String,
        usesMonospacedText: Bool = false
    ) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: NSpacing.md) {
            Text(label)
                .foregroundStyle(theme.tokens.mutedForeground)
            Spacer()
            Text(value)
                .font(usesMonospacedText ? .system(.caption, design: .monospaced) : NTypography.caption)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .font(NTypography.caption)
    }
}

private extension View {
    func connectionDetailCard() -> some View {
        modifier(ConnectionDetailCardModifier())
    }
}

private struct ConnectionDetailCardModifier: ViewModifier {
    @Environment(\.nTheme) private var theme

    func body(content: Content) -> some View {
        content
            .padding(NSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.tokens.background)
            .overlay(
                RoundedRectangle(cornerRadius: NRadius.md)
                    .stroke(theme.tokens.border, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
    }
}
