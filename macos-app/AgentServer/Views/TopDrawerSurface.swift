import SwiftUI
import NerdsUI

enum TopDrawerStyle {
    static let height: CGFloat = 640
    static let slideDuration: Double = 0.26
}

enum TopDrawerTitleStatus {
    case normal
    case working
    case error
}

struct TopDrawerSurface<HeaderActions: View, Content: View>: View {
    let title: String
    let closeLabel: String
    let onClose: () -> Void
    let onEscape: () -> Void
    let showsDivider: Bool
    let titleIcon: String?
    let titleStatus: TopDrawerTitleStatus
    private let headerActions: HeaderActions
    private let content: Content

    @Environment(\.nTheme) private var theme

    init(
        title: String,
        closeLabel: String,
        onClose: @escaping () -> Void,
        onEscape: (() -> Void)? = nil,
        showsDivider: Bool = true,
        titleIcon: String? = nil,
        titleStatus: TopDrawerTitleStatus = .normal,
        @ViewBuilder headerActions: () -> HeaderActions,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.closeLabel = closeLabel
        self.onClose = onClose
        self.onEscape = onEscape ?? onClose
        self.showsDivider = showsDivider
        self.titleIcon = titleIcon
        self.titleStatus = titleStatus
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
            onEscape()
            return .handled
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            if let titleIcon {
                titleStatusIcon(titleIcon)
                    .frame(width: 20, height: 20)
                    .padding(.top, NSpacing.xs)
                    .accessibilityHidden(true)
            }
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

    @ViewBuilder
    private func titleStatusIcon(_ systemName: String) -> some View {
        switch titleStatus {
        case .normal:
            Image(systemName: systemName)
                .foregroundStyle(theme.tokens.mutedForeground)
        case .working:
            ProgressView()
                .controlSize(.small)
        case .error:
            Image(systemName: systemName)
                .foregroundStyle(theme.tokens.destructive)
                .overlay(alignment: .topTrailing) {
                    Circle()
                        .fill(theme.tokens.destructive)
                        .frame(width: 6, height: 6)
                        .offset(x: 3, y: -2)
                }
        }
    }
}

extension TopDrawerSurface where HeaderActions == EmptyView {
    init(
        title: String,
        closeLabel: String,
        onClose: @escaping () -> Void,
        onEscape: (() -> Void)? = nil,
        showsDivider: Bool = true,
        titleIcon: String? = nil,
        titleStatus: TopDrawerTitleStatus = .normal,
        @ViewBuilder content: () -> Content
    ) {
        self.init(
            title: title,
            closeLabel: closeLabel,
            onClose: onClose,
            onEscape: onEscape,
            showsDivider: showsDivider,
            titleIcon: titleIcon,
            titleStatus: titleStatus,
            headerActions: EmptyView.init,
            content: content
        )
    }
}
