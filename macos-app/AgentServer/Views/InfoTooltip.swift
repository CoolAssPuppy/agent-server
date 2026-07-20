import SwiftUI
import AgentServerDesignSystem

/// Small info.circle icon that reveals a popover with explanatory copy when
/// tapped. Anchored to the trigger; popover is capped at 280pt wide with
/// 12pt inner padding and matches the theme's card/foreground tokens.
struct InfoTooltip: View {
    let text: String

    @Environment(\.nTheme) private var theme
    @State private var isPresented: Bool = false

    var body: some View {
        Button {
            isPresented.toggle()
        } label: {
            Image(systemName: "info.circle")
                .font(.system(size: 11))
                .foregroundStyle(theme.tokens.mutedForeground)
        }
        .buttonStyle(.plain)
        .help(text)
        .popover(isPresented: $isPresented, arrowEdge: .top) {
            Text(text)
                .font(NTypography.bodySmall)
                .foregroundStyle(theme.tokens.foreground)
                .padding(12)
                .frame(maxWidth: 280, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .background(theme.tokens.card)
        }
    }
}

extension InfoTooltip {
    /// Standard copy attached to every cost value across the macOS app.
    static let costExplanation: String = """
    These token and dollar figures come from the Claude Agent SDK. \
    If you're running Claude Code under an on-machine Claude subscription \
    you aren't billed per call. Treat this as telemetry, not a real charge.
    """
}
