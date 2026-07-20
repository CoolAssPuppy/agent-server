import SwiftUI
import AgentServerDesignSystem

enum AgentServerThemeId: String, CaseIterable, Identifiable {
    case nerds
    case starling
    case scully
    case hotchner
    case graff
    case kujan
    case ness

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .nerds: return "Nerds"
        case .starling: return "Starling"
        case .scully: return "Scully"
        case .hotchner: return "Hotchner"
        case .graff: return "Graff"
        case .kujan: return "Kujan"
        case .ness: return "Ness"
        }
    }

    var dotColor: Color {
        switch self {
        case .nerds: return Color(hex: "#FDB817")
        case .starling: return Color(hex: "#00FF41")
        case .scully: return Color(hex: "#5CB8E4")
        case .hotchner: return Color(hex: "#9B59B6")
        case .graff: return Color(hex: "#D4850A")
        case .kujan: return Color(hex: "#607D8B")
        case .ness: return Color(hex: "#CD7F32")
        }
    }

    var palette: any AppPalette {
        switch self {
        case .nerds: return NerdsPalette()
        case .starling: return StarlingPalette()
        case .scully: return ScullyPalette()
        case .hotchner: return HotchnerPalette()
        case .graff: return GraffPalette()
        case .kujan: return KujanPalette()
        case .ness: return NessPalette()
        }
    }
}

@MainActor
final class ThemeManager: ObservableObject {
    static let shared = ThemeManager()

    @Published var currentTheme: AgentServerThemeId {
        didSet {
            UserDefaults.standard.set(currentTheme.rawValue, forKey: "selectedTheme")
            themeConfig = ThemeConfiguration(palette: currentTheme.palette)
        }
    }

    @Published private(set) var themeConfig: ThemeConfiguration

    private init() {
        let saved = UserDefaults.standard.string(forKey: "selectedTheme") ?? AgentServerThemeId.nerds.rawValue
        let themeId = AgentServerThemeId(rawValue: saved) ?? .nerds
        self.currentTheme = themeId
        self.themeConfig = ThemeConfiguration(palette: themeId.palette)
    }
}
