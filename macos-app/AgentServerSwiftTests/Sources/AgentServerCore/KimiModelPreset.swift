public enum KimiModelPreset {
    public static let displayName = "Kimi K3"
    public static let model = "kimi-k3"
    public static let endpoint = "https://api.moonshot.ai/v1"
    public static let keyVariable = "MOONSHOT_API_KEY"
    public static let keyReference = "${\(keyVariable)}"

    public static func matches(model: String?, endpoint: String?) -> Bool {
        model == self.model && endpoint == self.endpoint
    }
}

public enum ModelDisplayName {
    public static func format(_ model: String) -> String {
        switch model.lowercased() {
        case "kimi-k3": return "Kimi K3"
        case "kimi-k2": return "Kimi K2"
        default: return model
        }
    }
}
