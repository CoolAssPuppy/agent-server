import SwiftUI

public enum NSpacing {
    public static let xxxs: CGFloat = 2
    public static let xxs: CGFloat = 4
    public static let xs: CGFloat = 8
    public static let sm: CGFloat = 12
    public static let md: CGFloat = 16
    public static let lg: CGFloat = 24
    public static let xl: CGFloat = 32
    public static let xxl: CGFloat = 48
    public static let huge: CGFloat = 64
}

public enum NRadius {
    public static let xs: CGFloat = 4
    public static let sm: CGFloat = 8
    public static let md: CGFloat = 12
    public static let lg: CGFloat = 16
}

public enum NIconSize {
    public static let xs: CGFloat = 12
    public static let lg: CGFloat = 28
}

public enum NTypography {
    public static let captionSmall = Font.system(size: 10)
    public static let caption = Font.system(size: 11)
    public static let bodySmall = Font.system(size: 12)
    public static let bodyMedium = Font.system(size: 13)
    public static let bodyLarge = Font.system(size: 15)
    public static let labelSmall = Font.system(size: 11, weight: .semibold)
    public static let labelMedium = Font.system(size: 13, weight: .semibold)
    public static let badge = Font.system(size: 10, weight: .bold)
    public static let headlineSmall = Font.system(size: 15, weight: .semibold)
    public static let headlineMedium = Font.system(size: 17, weight: .semibold)
    public static let headlineLarge = Font.system(size: 20, weight: .semibold)
    public static let titleLarge = Font.system(size: 24, weight: .bold)
    public static let displayMedium = Font.system(size: 32, weight: .bold)
}

public enum NAnimation {
    public static let bouncy = Animation.spring(response: 0.35, dampingFraction: 0.72)
}
