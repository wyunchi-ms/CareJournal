import Foundation

enum SQLiteDataProtection {
    private static let directory = "CapacitorDatabase"

    static func harden() {
        let fileManager = FileManager.default
        guard let library = fileManager.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
        var databaseDirectory = library.appendingPathComponent(directory, isDirectory: true)
        try? fileManager.createDirectory(at: databaseDirectory, withIntermediateDirectories: true)

        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? databaseDirectory.setResourceValues(values)
        try? databaseDirectory.setResourceValue(
            URLFileProtection.completeUntilFirstUserAuthentication,
            forKey: .fileProtectionKey
        )

        guard let files = try? fileManager.contentsOfDirectory(
            at: databaseDirectory,
            includingPropertiesForKeys: nil
        ) else { return }
        for var file in files {
            try? file.setResourceValue(
                URLFileProtection.completeUntilFirstUserAuthentication,
                forKey: .fileProtectionKey
            )
        }
    }
}
