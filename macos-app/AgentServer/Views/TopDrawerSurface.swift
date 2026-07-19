import SwiftUI
import NerdsUI

enum TopDrawerStyle {
    static let height: CGFloat = 640
    static let slideDuration: Double = 0.26
}

struct TopDrawerSurface<HeaderActions: View, Content: View>: View {
    let title: String
    let closeLabel: String
    let onClose: () -> Void
    let showsDivider: Bool
    private let headerActions: HeaderActions
    private let content: Content

    @Environment(\.nTheme) private var theme

    init(
        title: String,
        closeLabel: String,
        onClose: @escaping () -> Void,
        showsDivider: Bool = true,
        @ViewBuilder headerActions: () -> HeaderActions,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.closeLabel = closeLabel
        self.onClose = onClose
        self.showsDivider = showsDivider
        self.headerActions = headerActions()
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            if showsDivider { Divider().opacity(0.3) }
            content
        }
        .frame(maxWidth: .infinity)
        .frame(height: TopDrawerStyle.height)
        .background(theme.tokens.card)
        .clipShape(BottomRoundedRectangle(radius: NRadius.md))
        .compositingGroup()
        .shadow(color: Color.black.opacity(0.25), radius: 16, x: 0, y: 6)
        .onKeyPress(.escape) {
            onClose()
            return .handled
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            Text(title)
                .font(NTypography.headlineLarge)
                .foregroundStyle(theme.tokens.foreground)
                .padding(.top, NSpacing.xs)
            Spacer()
            headerActions
            Button(action: onClose) {
                ZStack {
                    Circle()
                        .fill(theme.tokens.muted)
                        .overlay(Circle().stroke(theme.tokens.border, lineWidth: 1))
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(theme.tokens.mutedForeground)
                }
                .frame(width: 28, height: 28)
                .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(closeLabel)
        }
        .padding(.horizontal, NSpacing.xxl)
        .padding(.top, 28)
        .padding(.bottom, NSpacing.md)
    }
}

extension TopDrawerSurface where HeaderActions == EmptyView {
    init(
        title: String,
        closeLabel: String,
        onClose: @escaping () -> Void,
        showsDivider: Bool = true,
        @ViewBuilder content: () -> Content
    ) {
        self.init(
            title: title,
            closeLabel: closeLabel,
            onClose: onClose,
            showsDivider: showsDivider,
            headerActions: EmptyView.init,
            content: content
        )
    }
}
