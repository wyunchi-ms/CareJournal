import Foundation
import CryptoKit

// Private storage layer for report images.
// Mirrors Android PrivateImageStore; stores files under
// Application Support/report-images/ using the same path/key/MIME semantics.
// The directory is excluded from iCloud backup because medical attachments are
// app-local data and can be exported explicitly by the user.
enum PrivateImageStore {

    static let directory = "report-images"

    struct StoredFile {
        let mimeType: String
        let sha256: String       // the key used as filename stem (may be caller-supplied)
        let storagePath: String  // e.g. "report-images/abc123.jpg"
        let localUri: String     // e.g. "file:///…/Application Support/report-images/abc123.jpg"
    }

    enum StoreError: LocalizedError {
        case emptyContent
        case invalidBase64Format
        case base64DecodeFailed
        case directoryCreationFailed
        case fileWriteFailed
        case fileNotFound
        case missingPath
        case pathTraversal
        case missingBaseDirectory
        case unsupportedMimeType
        case contentTooLarge
        case hashMismatch

        var errorDescription: String? {
            switch self {
            case .emptyContent:            return "图片内容为空"
            case .invalidBase64Format:     return "图片 Base64 格式无效"
            case .base64DecodeFailed:      return "图片 Base64 无法解码"
            case .directoryCreationFailed: return "无法创建图片存储目录"
            case .fileWriteFailed:         return "无法完成图片文件写入"
            case .fileNotFound:            return "本地图片文件不存在"
            case .missingPath:             return "缺少图片文件地址"
            case .pathTraversal:           return "图片文件地址无效"
            case .missingBaseDirectory:    return "无法获取 Application Support 目录"
            case .unsupportedMimeType:     return "不支持的素材类型"
            case .contentTooLarge:         return "单个素材不能超过 30 MB"
            case .hashMismatch:            return "素材内容校验失败"
            }
        }
    }

    // MARK: - Public API

    /// Decode a data-URL, derive MIME type from its header, and persist to disk.
    static func storeDataUrl(
        _ dataUrl: String,
        expectedSha256: String?,
        declaredMimeType: String
    ) throws -> StoredFile {
        let trimmed = dataUrl.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { throw StoreError.emptyContent }
        guard let commaIndex = trimmed.firstIndex(of: ",") else {
            throw StoreError.invalidBase64Format
        }
        let header = String(trimmed[trimmed.startIndex..<commaIndex])
        guard header.hasPrefix("data:"), header.hasSuffix(";base64") else {
            throw StoreError.invalidBase64Format
        }
        let mimeType = mimeTypeFromHeader(header, fallback: declaredMimeType)
        guard mimeType == "application/pdf" || mimeType.hasPrefix("image/") else {
            throw StoreError.unsupportedMimeType
        }
        let base64Part = String(trimmed[trimmed.index(after: commaIndex)...])
        let maximumBytes = 30 * 1024 * 1024
        let maximumBase64Length = ((maximumBytes + 2) / 3) * 4
        guard base64Part.utf8.count <= maximumBase64Length else { throw StoreError.contentTooLarge }
        guard let bytes = Data(base64Encoded: base64Part) else {
            throw StoreError.base64DecodeFailed
        }
        guard bytes.count <= maximumBytes else { throw StoreError.contentTooLarge }
        return try storeBytes(bytes, expectedSha256: expectedSha256, mimeType: mimeType)
    }

    /// Persist raw bytes. The key determines the filename stem; a fresh SHA-256 is
    /// computed and used as fallback when the provided key is empty or all non-ASCII.
    static func storeBytes(
        _ bytes: Data,
        expectedSha256: String?,
        mimeType: String
    ) throws -> StoredFile {
        guard !bytes.isEmpty else { throw StoreError.emptyContent }
        let normalizedMime = normalizeMimeType(mimeType)

        let actualSha256 = sha256Hex(bytes)
        if let expected = expectedSha256?.trimmingCharacters(in: .whitespaces).lowercased(),
           !expected.isEmpty,
           expected != actualSha256 {
            throw StoreError.hashMismatch
        }

        let dirURL = try storageDirectory()
        let filename = actualSha256 + extensionFor(normalizedMime)
        var targetURL = dirURL.appendingPathComponent(filename)

        // Skip writing if already present (content-addressed dedup)
        if !FileManager.default.fileExists(atPath: targetURL.path) {
            let tmpURL = dirURL.appendingPathComponent("image-\(UUID().uuidString).tmp")
            var moved = false
            defer { if !moved { try? FileManager.default.removeItem(at: tmpURL) } }
            try bytes.write(to: tmpURL, options: .completeFileProtectionUntilFirstUserAuthentication)
            do {
                try FileManager.default.moveItem(at: tmpURL, to: targetURL)
                moved = true
            } catch {
                // Another concurrent write may have placed the file first — that's fine
                guard FileManager.default.fileExists(atPath: targetURL.path) else {
                    throw StoreError.fileWriteFailed
                }
            }
        }
        try? targetURL.setResourceValue(
            URLFileProtection.completeUntilFirstUserAuthentication,
            forKey: .fileProtectionKey
        )

        let storagePath = directory + "/" + filename
        return StoredFile(
            mimeType: normalizedMime,
            sha256: actualSha256,
            storagePath: storagePath,
            localUri: targetURL.absoluteString   // file:///…
        )
    }

    /// Read stored bytes for a given storagePath (e.g. "report-images/sha256.jpg").
    static func readBytes(_ storagePath: String) throws -> Data {
        let targetURL = try resolveStoragePath(storagePath)
        guard FileManager.default.fileExists(atPath: targetURL.path) else {
            throw StoreError.fileNotFound
        }
        return try Data(contentsOf: targetURL)
    }

    static func dataUrl(mimeType: String, bytes: Data) -> String {
        "data:\(normalizeMimeType(mimeType));base64,\(bytes.base64EncodedString())"
    }

    /// Infer MIME type from a storage path extension, matching Android's mimeTypeForPath.
    static func mimeTypeForPath(_ storagePath: String) -> String {
        let lower = storagePath.lowercased()
        if lower.hasSuffix(".pdf")  { return "application/pdf" }
        if lower.hasSuffix(".png")  { return "image/png" }
        if lower.hasSuffix(".webp") { return "image/webp" }
        return "image/jpeg"
    }

    // MARK: - Directory helpers

    /// Returns (and creates if necessary) the storage directory URL.
    static func storageDirectory() throws -> URL {
        guard let base = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            throw StoreError.missingBaseDirectory
        }
        let dir = base.appendingPathComponent(directory, isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            do {
                try FileManager.default.createDirectory(
                    at: dir,
                    withIntermediateDirectories: true
                )
            } catch {
                throw StoreError.directoryCreationFailed
            }
        }
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var protectedDirectory = dir
        try? protectedDirectory.setResourceValues(values)
        try? protectedDirectory.setResourceValue(
            URLFileProtection.completeUntilFirstUserAuthentication,
            forKey: .fileProtectionKey
        )
        return dir
    }

    /// Resolve a storagePath to an absolute URL, rejecting any path-traversal attempt.
    /// storagePath must be relative to Application Support (e.g. "report-images/sha256.jpg").
    static func resolveStoragePath(_ storagePath: String) throws -> URL {
        let trimmed = storagePath.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { throw StoreError.missingPath }
        guard let base = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            throw StoreError.missingBaseDirectory
        }
        // Canonical root that all valid paths must be under
        let rootURL = base.appendingPathComponent(directory, isDirectory: true).standardizedFileURL.resolvingSymlinksInPath()
        let rootPath = rootURL.path + "/"
        let targetURL = base.appendingPathComponent(trimmed).standardizedFileURL.resolvingSymlinksInPath()
        guard targetURL.path.hasPrefix(rootPath) else {
            throw StoreError.pathTraversal
        }
        return targetURL
    }

    // MARK: - MIME helpers (private)

    private static func mimeTypeFromHeader(_ header: String, fallback: String) -> String {
        // header looks like "data:image/jpeg;base64" — extract the MIME part
        if header.hasPrefix("data:"), let semiIdx = header.firstIndex(of: ";") {
            let mime = String(
                header[header.index(header.startIndex, offsetBy: 5)..<semiIdx]
            )
            if !mime.isEmpty { return normalizeMimeType(mime) }
        }
        return normalizeMimeType(fallback)
    }

    private static func normalizeMimeType(_ mimeType: String) -> String {
        let s = mimeType.trimmingCharacters(in: .whitespaces).lowercased()
        if s == "application/pdf" { return s }
        return s.hasPrefix("image/") ? s : "image/jpeg"
    }

    private static func extensionFor(_ mimeType: String) -> String {
        switch mimeType {
        case "application/pdf": return ".pdf"
        case "image/png":       return ".png"
        case "image/webp":      return ".webp"
        default:                return ".jpg"
        }
    }

    // MARK: - CryptoKit SHA-256

    private static func sha256Hex(_ data: Data) -> String {
        let hash = SHA256.hash(data: data)
        return hash.map { String(format: "%02x", $0) }.joined()
    }
}
