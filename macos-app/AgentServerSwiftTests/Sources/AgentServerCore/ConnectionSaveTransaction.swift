import Foundation

public enum ConnectionSaveTransaction {
    public static func run<Profile>(
        saveCredentials: () async throws -> Void,
        saveProfile: () async throws -> Profile,
        restoreCredentials: () async -> Void
    ) async throws -> Profile {
        try await saveCredentials()
        do {
            return try await saveProfile()
        } catch {
            await restoreCredentials()
            throw error
        }
    }
}
