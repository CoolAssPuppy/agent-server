public enum ThemePickerMotion: Equatable, Sendable {
    case bouncy
    case none
}

public struct ThemePickerPresentation: Equatable, Sendable {
    public private(set) var isExpanded = false

    public init() {}

    public mutating func setHovering(_ isHovering: Bool) {
        isExpanded = isHovering
    }

    public mutating func toggleExpanded() {
        isExpanded.toggle()
    }

    public mutating func didSelectTheme() {
        isExpanded = false
    }

    public static func motion(reduceMotion: Bool) -> ThemePickerMotion {
        reduceMotion ? .none : .bouncy
    }
}
