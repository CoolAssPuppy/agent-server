import SwiftUI

struct AboutView: View {
    private var version: String {
        let short = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
        return "Version \(short) (\(build))"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Image("StrategicNerdsLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 220)
                    .padding(.top, 24)

                VStack(spacing: 4) {
                    Text("\u{00A9} 2026 Strategic Nerds, Inc.")
                    Text("Made in Lisbon, Portugal.")
                    Text(version)
                        .foregroundStyle(.secondary)
                        .padding(.top, 6)
                }
                .font(.system(size: 12))
                .multilineTextAlignment(.center)

                VStack(alignment: .leading, spacing: 10) {
                    AboutLinkRow(
                        title: "Report a problem",
                        systemImage: "ladybug",
                        destination: "mailto:bugs@agentpanel.dev"
                    )
                    AboutLinkRow(
                        title: "Agent Server on GitHub",
                        systemImage: "chevron.left.forwardslash.chevron.right",
                        destination: "https://github.com/coolasspuppy/agent-server"
                    )
                    AboutLinkRow(
                        title: "Agent Panel",
                        systemImage: "rectangle.connected.to.line.below",
                        destination: "https://www.agentpanel.dev"
                    )
                    AboutLinkRow(
                        title: "Support development",
                        systemImage: "cup.and.saucer",
                        destination: "https://venmo.com/u/coolasspuppy"
                    )
                    AboutLinkRow(
                        title: "Picks and Shovels",
                        systemImage: "book.closed",
                        destination: "https://www.strategicnerds.com/picksandshovels"
                    )
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 28)
            }
            .padding(.bottom, 24)
        }
        .frame(width: 360)
        .textSelection(.enabled)
    }
}

private struct AboutLinkRow: View {
    let title: String
    let systemImage: String
    let destination: String

    var body: some View {
        Link(destination: URL(string: destination)!) {
            Label(title, systemImage: systemImage)
                .font(.system(size: 12))
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(title)
    }
}
