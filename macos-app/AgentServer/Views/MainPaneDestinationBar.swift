import SwiftUI
import AgentServerDesignSystem

struct MainPaneDestinationBar: View {
    @Binding var selection: MainDestination

    @Environment(\.nTheme) private var theme

    private let destinations: [MainDestination] = [.today, .activity]

    var body: some View {
        HStack(spacing: NSpacing.xs) {
            ForEach(destinations) { destination in
                Button {
                    selection = destination
                } label: {
                    Label(destination.title, systemImage: destination.systemImage)
                        .font(NTypography.labelMedium)
                        .foregroundStyle(
                            selection == destination
                                ? theme.tokens.primaryForeground
                                : theme.tokens.foreground
                        )
                        .padding(.horizontal, NSpacing.md)
                        .frame(height: 32)
                        .background(
                            selection == destination
                                ? theme.tokens.primary
                                : theme.tokens.muted
                        )
                        .clipShape(RoundedRectangle(cornerRadius: NRadius.sm))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(destination.accessibilityLabel)
                .accessibilityAddTraits(selection == destination ? .isSelected : [])
                .accessibilityIdentifier(destination.accessibilityIdentifier)
            }
            Spacer()
        }
        .padding(.horizontal, NSpacing.xxl)
        .frame(maxWidth: 820)
        .frame(maxWidth: .infinity)
        .frame(height: 52)
        .background(theme.tokens.background)
        .overlay(alignment: .bottom) { Divider().opacity(0.3) }
    }
}
