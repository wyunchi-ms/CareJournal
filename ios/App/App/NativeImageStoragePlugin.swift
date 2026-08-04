import Capacitor
import Foundation

/// Capacitor plugin "NativeImageStorage" — iOS counterpart to Android's ImageStoragePlugin.
///
/// Stores report images in the app-private Application Support/report-images/ directory.
/// Returns the same JSON keys (mimeType, sha256, storagePath, localUri) as Android so the
/// shared TypeScript layer requires no special-casing.
public class NativeImageStoragePlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "NativeImageStoragePlugin"
    public let jsName = "NativeImageStorage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "persistImage",       returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readImage",           returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "migrateLegacyImages", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "garbageCollect",      returnType: CAPPluginReturnPromise),
    ]

    // Serial queue — mirrors Android's single-thread executor
    private let queue = DispatchQueue(
        label: "com.carejournal.app.imageStorage",
        qos: .utility
    )

    // MARK: - persistImage

    @objc func persistImage(_ call: CAPPluginCall) {
        let dataUrl  = call.getString("dataUrl")  ?? ""
        let sha256   = call.getString("sha256")   ?? ""
        let mimeType = call.getString("mimeType") ?? "image/jpeg"

        queue.async {
            do {
                let stored = try PrivateImageStore.storeDataUrl(
                    dataUrl,
                    expectedSha256: sha256.isEmpty ? nil : sha256,
                    declaredMimeType: mimeType
                )
                call.resolve([
                    "mimeType":    stored.mimeType,
                    "sha256":      stored.sha256,
                    "storagePath": stored.storagePath,
                    "localUri":    stored.localUri,
                ])
            } catch {
                call.reject("保存本地图片失败：\(error.localizedDescription)", nil, error)
            }
        }
    }

    // MARK: - readImage

    @objc func readImage(_ call: CAPPluginCall) {
        let storagePath = call.getString("storagePath") ?? ""

        queue.async {
            do {
                let bytes    = try PrivateImageStore.readBytes(storagePath)
                let mimeType = PrivateImageStore.mimeTypeForPath(storagePath)
                let dataUrl  = PrivateImageStore.dataUrl(mimeType: mimeType, bytes: bytes)
                call.resolve([
                    "mimeType": mimeType,
                    "dataUrl":  dataUrl,
                ])
            } catch {
                call.reject("读取本地图片失败：\(error.localizedDescription)", nil, error)
            }
        }
    }

    // MARK: - migrateLegacyImages

    /// iOS has no legacy SQLite database with inline base64 images to migrate.
    /// Returns an honest zero-count result so the caller can continue safely.
    @objc func migrateLegacyImages(_ call: CAPPluginCall) {
        call.resolve([
            "migratedEntities": 0,
            "migratedImages":   0,
            "failedEntities":   0,
            "compacted":        false,
        ])
    }

    // MARK: - garbageCollect

    @objc func garbageCollect(_ call: CAPPluginCall) {
        // Collect the live-path set on the calling thread, before going async
        var keepSet = Set<String>()
        if let paths = call.getArray("storagePaths") {
            for item in paths {
                if let path = item as? String,
                   path.hasPrefix(PrivateImageStore.directory + "/") {
                    keepSet.insert(path)
                }
            }
        }

        queue.async {
            var deleted = 0

            // If the storage directory has never been created there is nothing to collect
            guard let base = FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first else {
                call.resolve(["deleted": 0])
                return
            }
            let dirURL = base.appendingPathComponent(
                PrivateImageStore.directory,
                isDirectory: true
            )
            guard FileManager.default.fileExists(atPath: dirURL.path),
                  let contents = try? FileManager.default.contentsOfDirectory(
                      at: dirURL,
                      includingPropertiesForKeys: nil
                  )
            else {
                call.resolve(["deleted": 0])
                return
            }

            for fileURL in contents {
                let filename    = fileURL.lastPathComponent
                let storagePath = PrivateImageStore.directory + "/" + filename
                // Delete: not in the keep set, OR is a leftover .tmp file
                if !keepSet.contains(storagePath) || filename.hasSuffix(".tmp") {
                    do {
                        try FileManager.default.removeItem(at: fileURL)
                        deleted += 1
                    } catch {
                        // Skip files we cannot remove
                    }
                }
            }
            call.resolve(["deleted": deleted])
        }
    }
}
