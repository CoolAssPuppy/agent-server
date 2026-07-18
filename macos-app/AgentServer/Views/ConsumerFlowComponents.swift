import SwiftUI
import NerdsUI

struct ConsumerFlowHeader: View {
    let title: String
    let explanation: String

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.xxs) {
            Text(title)
                .font(NTypography.headlineLarge)
                .foregroundStyle(theme.tokens.foreground)
            Text(explanation)
                .font(NTypography.bodyLarge)
                .foregroundStyle(theme.tokens.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct ConsumerSection<Content: View>: View {
    let title: String
    let content: Content

    @Environment(\.nTheme) private var theme

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Text(title)
                .font(NTypography.headlineSmall)
                .foregroundStyle(theme.tokens.foreground)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(NSpacing.lg)
        .background(theme.tokens.card)
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
        .overlay {
            RoundedRectangle(cornerRadius: NRadius.md)
                .strokeBorder(theme.tokens.border.opacity(0.7))
        }
    }
}

struct ConsumerRiskLabel: View {
    let risk: ConsumerRiskLevel

    @Environment(\.nTheme) private var theme

    var body: some View {
        Label(risk.title, systemImage: icon)
            .font(NTypography.badge)
            .foregroundStyle(foreground)
            .padding(.horizontal, NSpacing.sm)
            .padding(.vertical, NSpacing.xxs)
            .background(foreground.opacity(0.12))
            .clipShape(Capsule())
            .accessibilityLabel("Security level: \(risk.title)")
    }

    private var icon: String {
        switch risk {
        case .low: return "checkmark.shield"
        case .needsReview: return "exclamationmark.shield"
        case .high: return "exclamationmark.triangle"
        case .critical: return "xmark.shield"
        }
    }

    private var foreground: Color {
        switch risk {
        case .low: return theme.tokens.success
        case .needsReview: return theme.tokens.warning
        case .high, .critical: return theme.tokens.error
        }
    }
}

struct ConsumerFlowFailureView: View {
    let failure: ConsumerFlowFailure
    let retry: (() -> Void)?

    @Environment(\.nTheme) private var theme
    @State private var showsDetails = false

    var body: some View {
        ConsumerSection(failure.title) {
            Label(failure.message, systemImage: "exclamationmark.triangle")
                .font(NTypography.bodyLarge)
                .foregroundStyle(theme.tokens.error)
            Text(failure.didSave ? "Your changes were saved." : "Nothing was saved.")
                .font(NTypography.bodyMedium)
            Text(failure.recovery)
                .font(NTypography.bodyLarge)
                .foregroundStyle(theme.tokens.mutedForeground)
            HStack {
                if failure.canRetry, let retry {
                    Button("Try again", action: retry)
                        .buttonStyle(.borderedProminent)
                }
                DisclosureGroup("Advanced details", isExpanded: $showsDetails) {
                    Text(failure.technicalDetails)
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, NSpacing.xs)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

struct ConsumerProgressView: View {
    let title: String
    let message: String

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(spacing: NSpacing.md) {
            ProgressView()
                .controlSize(.large)
            Text(title)
                .font(NTypography.headlineSmall)
            Text(message)
                .font(NTypography.bodyLarge)
                .foregroundStyle(theme.tokens.mutedForeground)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 240)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
    }
}
