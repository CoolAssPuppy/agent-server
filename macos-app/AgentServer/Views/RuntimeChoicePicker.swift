import SwiftUI
import NerdsUI

struct RuntimeChoicePicker: View {
    let options: [CreationRuntimeOption]
    @Binding var selection: String

    @Environment(\.nTheme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: NSpacing.md) {
            ForEach(options) { option in
                runtimeButton(option)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private func runtimeButton(_ option: CreationRuntimeOption) -> some View {
        let isSelected = selection == option.value
        return Button {
            selection = option.value
        } label: {
            VStack(spacing: NSpacing.md) {
                Image(option.brandAssetName)
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(theme.tokens.foreground)
                    .frame(width: 42, height: 42)
                    .accessibilityHidden(true)
                VStack(spacing: NSpacing.xxs) {
                    Text(option.label)
                        .font(NTypography.bodyMedium)
                        .foregroundStyle(theme.tokens.foreground)
                    if let reason = option.disabledReason {
                        Text(reason)
                            .font(NTypography.captionSmall)
                            .foregroundStyle(theme.tokens.mutedForeground)
                            .multilineTextAlignment(.center)
                    }
                }
            }
            .frame(maxWidth: .infinity, minHeight: 132, alignment: .center)
            .padding(NSpacing.md)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(option.isDisabled)
        .background(isSelected ? theme.tokens.accent.opacity(0.12) : theme.tokens.card)
        .overlay {
            RoundedRectangle(cornerRadius: NRadius.md)
                .stroke(isSelected ? theme.tokens.accent : theme.tokens.border, lineWidth: isSelected ? 2 : 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: NRadius.md))
        .opacity(option.isDisabled ? 0.55 : 1)
        .accessibilityLabel(option.label)
        .accessibilityValue(accessibilityValue(option, isSelected: isSelected))
        .accessibilityIdentifier(ConsumerFlowAccessibility.creationRuntimePrefix + option.value)
    }

    private func accessibilityValue(_ option: CreationRuntimeOption, isSelected: Bool) -> String {
        if let reason = option.disabledReason { return "Unavailable. \(reason)" }
        return isSelected ? "Selected" : "Not selected"
    }
}

private extension CreationRuntimeOption {
    var brandAssetName: String {
        switch value {
        case "codex": "BrandOpenAI"
        case "claude-code": "BrandClaude"
        case "kimi-code": "BrandKimi"
        default: "BrandOpenAI"
        }
    }
}
