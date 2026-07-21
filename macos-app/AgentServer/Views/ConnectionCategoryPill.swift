import AgentServerDesignSystem
import SwiftUI

struct ConnectionCategoryPill: View {
    let category: ConnectionCategory

    @Environment(\.nTheme) private var theme

    var body: some View {
        Text(category.label)
            .font(NTypography.captionSmall)
            .fontWeight(.medium)
            .foregroundStyle(theme.tokens.mutedForeground)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(theme.tokens.muted.opacity(0.7), in: Capsule())
            .fixedSize(horizontal: true, vertical: false)
            .accessibilityLabel("Connection type: \(category.label)")
    }
}
