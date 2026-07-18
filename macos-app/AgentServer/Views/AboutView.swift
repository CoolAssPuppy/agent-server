import SwiftUI

struct AboutView: View {
    private var version: String {
        let short = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
        return "Version \(short) (\(build))"
    }

    var body: some View {
        VStack(spacing: 18) {
            Image("StrategicNerdsLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 240)
                .padding(.top, 24)

            VStack(spacing: 4) {
                Text("\u{00A9} 2026 Strategic Nerds, Inc.")
                Text("Made with love in Lisbon, Portugal.")
                Text(version)
                    .foregroundStyle(.secondary)
                    .padding(.top, 6)
            }
            .font(.system(size: 12))
            .multilineTextAlignment(.center)

            Link("Buy me coffee via Venmo: @coolasspuppy",
                 destination: URL(string: "https://venmo.com/coolasspuppy")!)
                .font(.system(size: 12))
                .padding(.top, 4)
        }
        .padding(.horizontal, 32)
        .padding(.bottom, 24)
        .frame(width: 360)
        .textSelection(.enabled)
    }
}
