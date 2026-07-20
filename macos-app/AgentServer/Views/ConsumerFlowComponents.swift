import SwiftUI
import NerdsUI

struct ConsumerFlowHeader: View {
    let title: String
    let explanation: String?

    init(title: String, explanation: String? = nil) {
        self.title = title
        self.explanation = explanation
    }

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: NSpacing.xxs) {
            Text(title)
                .font(NTypography.headlineLarge)
                .foregroundStyle(theme.tokens.foreground)
            if let explanation, !explanation.isEmpty {
                Text(explanation)
                    .font(NTypography.bodyLarge)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

enum ConsumerSectionStyle {
    case card
    case flat
}

struct ConsumerSection<Content: View>: View {
    let title: String
    let style: ConsumerSectionStyle
    let content: Content

    @Environment(\.nTheme) private var theme

    init(_ title: String, style: ConsumerSectionStyle = .card, @ViewBuilder content: () -> Content) {
        self.title = title
        self.style = style
        self.content = content()
    }

    var body: some View {
        if style == .card {
            sectionContent
                .padding(NSpacing.lg)
                .background(theme.tokens.card)
                .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
                .overlay {
                    RoundedRectangle(cornerRadius: NRadius.md)
                        .strokeBorder(theme.tokens.border.opacity(0.7))
                }
        } else {
            sectionContent
                .padding(.vertical, NSpacing.md)
        }
    }

    private var sectionContent: some View {
        VStack(alignment: .leading, spacing: NSpacing.sm) {
            Text(title)
                .font(NTypography.headlineSmall)
                .foregroundStyle(theme.tokens.foreground)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
    @AccessibilityFocusState private var isFailureFocused: Bool

    var body: some View {
        VStack(spacing: NSpacing.md) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(theme.tokens.error)
                .accessibilityHidden(true)
            Text(failure.title)
                .font(NTypography.headlineSmall)
                .foregroundStyle(theme.tokens.foreground)
                .multilineTextAlignment(.center)
                .accessibilityFocused($isFailureFocused)
            Text(failure.conciseMessage)
                .font(NTypography.bodyMedium)
                .foregroundStyle(theme.tokens.mutedForeground)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let recovery = failure.visibleRecovery {
                Text(recovery)
                    .font(NTypography.bodyMedium)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .multilineTextAlignment(.center)
            }
            HStack(spacing: NSpacing.sm) {
                if failure.canRetry, let retry {
                    Button("Try again", action: retry)
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier(ConsumerFlowAccessibility.failureRetry)
                }
                Button {
                    showsDetails.toggle()
                } label: {
                    Text(showsDetails ? "Hide details" : "Details")
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier(ConsumerFlowAccessibility.failureDetails)
            }
            if showsDetails {
                Text(failure.technicalDetails)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(NSpacing.md)
                    .background(theme.tokens.muted.opacity(0.45))
                    .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
            }
        }
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity, minHeight: 340, alignment: .center)
        .accessibilityElement(children: .contain)
        .onAppear { isFailureFocused = true }
    }
}

struct ConsumerProgressView: View {
    let title: String
    let message: String?

    init(title: String, message: String? = nil) {
        self.title = title
        self.message = message
    }

    @Environment(\.nTheme) private var theme

    var body: some View {
        VStack(spacing: NSpacing.md) {
            ProgressView()
                .controlSize(.large)
            Text(title)
                .font(NTypography.headlineSmall)
            if let message, !message.isEmpty {
                Text(message)
                    .font(NTypography.bodyLarge)
                    .foregroundStyle(theme.tokens.mutedForeground)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 240)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
    }
}
