import SwiftUI
import NerdsUI

/// Renders a capability's icon: the real product logo (a bundled brand mark) for
/// a recognized service, or an SF Symbol for a generic action (read files, run
/// commands, browse the web). Brand marks are template images so they take the
/// theme's color — crisp and recognizable on every theme, and the same visual
/// language whether the capability is on or off.
struct CapabilityIconView: View {
    let capability: AgentCapability
    var size: CGFloat = 16
    var tint: Color

    var body: some View {
        Group {
            if let asset = CapabilityBrand.asset(for: capability) {
                Image(asset)
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
            } else {
                Image(systemName: capability.icon)
                    .resizable()
                    .scaledToFit()
                    .fontWeight(.medium)
            }
        }
        .frame(width: size, height: size)
        .foregroundStyle(tint)
    }
}

/// Maps a capability to a bundled brand asset. Matches on the capability id
/// first (catalog services) and falls back to the underlying MCP server name so
/// a hand-declared server like `notion-personal` still gets the Notion logo.
enum CapabilityBrand {
    static func asset(for capability: AgentCapability) -> String? {
        if let byId = byCapabilityId[capability.id] { return byId }
        let haystack = (capability.serverName ?? capability.id).lowercased()
        for (needle, asset) in byServerNeedle where haystack.contains(needle) {
            return asset
        }
        return nil
    }

    static func asset(forServiceName name: String) -> String? {
        let haystack = name.lowercased()
        return byServerNeedle.first(where: { haystack.contains($0.0) })?.1
    }

    private static let byCapabilityId: [String: String] = [
        "notion": "BrandNotion",
        "slack": "BrandSlack",
        "linear": "BrandLinear",
        "gmail": "BrandGmail",
        "telegram": "BrandTelegram",
    ]

    private static let byServerNeedle: [(String, String)] = [
        ("notion", "BrandNotion"),
        ("slack", "BrandSlack"),
        ("linear", "BrandLinear"),
        ("gmail", "BrandGmail"),
        ("figma", "BrandFigma"),
        ("gcal", "BrandGoogleCalendar"),
        ("google-calendar", "BrandGoogleCalendar"),
        ("gdrive", "BrandGoogleDrive"),
        ("google-drive", "BrandGoogleDrive"),
        ("gdocs", "BrandGoogleDocs"),
        ("google-docs", "BrandGoogleDocs"),
    ]
}
