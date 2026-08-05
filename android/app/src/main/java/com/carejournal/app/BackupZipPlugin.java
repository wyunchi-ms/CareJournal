package com.carejournal.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@CapacitorPlugin(name = "BackupZip")
public class BackupZipPlugin extends Plugin {
    private static final String ZIP_FORMAT = "carejournal-zip-v1";
    private static final int BUFFER_SIZE = 64 * 1024;
    private static final int MAX_ENTRY_COUNT = 20000;
    private static final long MAX_BACKUP_JSON_BYTES = 10L * 1024L * 1024L;
    private static final long MAX_ASSET_BYTES = 48L * 1024L * 1024L;
    private static final long MAX_TOTAL_UNCOMPRESSED_BYTES = 128L * 1024L * 1024L;
    private static final int MAX_ENTITY_COUNT = 100000;
    private static final Set<String> HEIF_BRANDS = new HashSet<>();

    static {
        String[] brands = { "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1" };
        for (String brand : brands) HEIF_BRANDS.add(brand);
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void save(PluginCall call) {
        String filename = safeFilename(call.getString("filename", "carejournal-backup.zip"));
        JSONObject payload = call.getObject("payload");
        if (payload == null) {
            call.reject("缺少备份内容");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/zip");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "documentCreated");
    }

    @ActivityCallback
    private void documentCreated(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        Intent data = activityResult.getData();
        if (activityResult.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject result = new JSObject();
            result.put("cancelled", true);
            call.resolve(result);
            return;
        }

        Uri targetUri = data.getData();
        JSONObject payload = call.getObject("payload");
        String filename = safeFilename(call.getString("filename", "carejournal-backup.zip"));
        executor.execute(() -> {
            File temporary = null;
            try {
                if (payload == null) throw new IOException("缺少备份内容");
                temporary = File.createTempFile("carejournal-backup-", ".zip", getContext().getCacheDir());
                SaveStats stats = writeTemporaryZip(temporary, payload);
                copyToUri(temporary, targetUri);
                JSObject result = new JSObject();
                result.put("cancelled", false);
                result.put("path", targetUri.toString());
                result.put("filename", filename);
                result.put("assetCount", stats.assetCount);
                result.put("bytesWritten", temporary.length());
                call.resolve(result);
            } catch (Exception error) {
                deleteSafDocument(targetUri);
                call.reject("导出备份失败：" + safeMessage(error), error);
            } finally {
                if (temporary != null && temporary.exists() && !temporary.delete()) temporary.deleteOnExit();
            }
        });
    }

    private SaveStats writeTemporaryZip(File target, JSONObject sourcePayload) throws IOException, JSONException {
        JSONObject payload = new JSONObject(sourcePayload.toString());
        assertEntityLimits(payload);
        JSONArray assets = payload.optJSONArray("assets");
        if (assets == null) throw new IOException("备份素材索引无效");
        if (assets.length() > MAX_ENTITY_COUNT) throw new IOException("备份素材过多");

        JSONArray manifest = new JSONArray();
        Map<String, String> repairedIds = new HashMap<>();
        Set<String> emittedHashes = new HashSet<>();
        JSONArray payloadAssets = new JSONArray();
        long totalUncompressed = 0L;
        int entryCount = 0;

        try (ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(target), BUFFER_SIZE))) {
            zip.setLevel(java.util.zip.Deflater.DEFAULT_COMPRESSION);
            for (int index = 0; index < assets.length(); index += 1) {
                JSONObject sourceAsset = assets.getJSONObject(index);
                AssetResult result = writeAsset(zip, sourceAsset, emittedHashes);
                repairedIds.put(sourceAsset.getString("id"), result.id);
                if (result.size > MAX_ASSET_BYTES) throw new IOException("备份素材大小无效");
                if (result.emitted) totalUncompressed += result.size;
                if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new IOException("备份素材大小无效");
                if (result.emitted) entryCount += 1;
                if (entryCount > MAX_ENTRY_COUNT) throw new IOException("备份文件条目过多");
                if (!result.duplicate) {
                    payloadAssets.put(stripLocalAssetFields(sourceAsset, result.id, result.sha256));
                    manifest.put(assetManifest(sourceAsset, result));
                }
            }

            remapPayloadReferences(payload, repairedIds);
            payload.put("assets", payloadAssets);
            JSONObject wrapper = new JSONObject();
            wrapper.put("format", ZIP_FORMAT);
            wrapper.put("exportedAt", payload.getString("exportedAt"));
            wrapper.put("payload", payload);
            wrapper.put("assetManifest", manifest);
            byte[] backupJson = wrapper.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
            if (backupJson.length > MAX_BACKUP_JSON_BYTES) throw new IOException("备份索引过大");
            totalUncompressed += backupJson.length;
            if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new IOException("备份文件过大");
            zip.putNextEntry(new ZipEntry("backup.json"));
            zip.write(backupJson);
            zip.closeEntry();
            entryCount += 1;
            if (entryCount > MAX_ENTRY_COUNT) throw new IOException("备份文件条目过多");
        }
        return new SaveStats(manifest.length());
    }

    private AssetResult writeAsset(ZipOutputStream zip, JSONObject asset, Set<String> emittedHashes) throws IOException, JSONException {
        String storagePath = asset.optString("storagePath", "");
        if (!storagePath.startsWith(PrivateImageStore.DIRECTORY + "/")) throw new IOException("素材 " + asset.optString("name", asset.optString("id", "")) + " 缺少本机存储路径");
        File file = resolvePrivateFile(storagePath);
        if (!file.isFile()) throw new IOException("本地素材文件不存在：" + asset.optString("name", storagePath));
        if (file.length() > MAX_ASSET_BYTES) throw new IOException("单个备份素材不能超过 48MiB");

        MessageDigest digest = sha256Digest();
        byte[] magic = new byte[16];
        int magicLength = 0;
        long size = 0L;
        String mimeType = asset.getString("mimeType");

        try (DigestInputStream input = new DigestInputStream(new BufferedInputStream(new FileInputStream(file), BUFFER_SIZE), digest);
             BufferedInputStream buffered = new BufferedInputStream(input, BUFFER_SIZE)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int count;
            while ((count = buffered.read(buffer)) >= 0) {
                if (count == 0) continue;
                if (magicLength < magic.length) {
                    int copy = Math.min(count, magic.length - magicLength);
                    System.arraycopy(buffer, 0, magic, magicLength, copy);
                    magicLength += copy;
                }
                size += count;
                if (size > MAX_ASSET_BYTES) throw new IOException("单个备份素材不能超过 48MiB");
            }
        }

        String sha256 = hex(digest.digest());
        validateMagic(magic, magicLength, mimeType);
        String id = "sha256:" + sha256;
        String path = "assets/" + sha256 + "." + extensionFor(mimeType);
        boolean duplicate = emittedHashes.contains(sha256);
        boolean emitted = false;
        if (!duplicate) {
            emittedHashes.add(sha256);
            zip.putNextEntry(new ZipEntry(path));
            long written = 0L;
            try (BufferedInputStream input = new BufferedInputStream(new FileInputStream(file), BUFFER_SIZE)) {
                byte[] buffer = new byte[BUFFER_SIZE];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (count == 0) continue;
                    written += count;
                    if (written > MAX_ASSET_BYTES) throw new IOException("单个备份素材不能超过 48MiB");
                    zip.write(buffer, 0, count);
                }
            }
            zip.closeEntry();
            if (written != size) throw new IOException("备份素材读取过程中发生变化");
            emitted = true;
        }
        return new AssetResult(id, sha256, size, path, duplicate, emitted);
    }

    private JSONObject stripLocalAssetFields(JSONObject source, String id, String sha256) throws JSONException {
        JSONObject asset = new JSONObject(source.toString());
        asset.put("id", id);
        asset.put("sha256", sha256);
        asset.put("dataUrl", "");
        asset.remove("storagePath");
        asset.remove("localUri");
        asset.remove("sourceUri");
        asset.remove("sourceKey");
        asset.remove("relativePath");
        asset.remove("pendingSync");
        return asset;
    }

    private JSONObject assetManifest(JSONObject source, AssetResult result) throws JSONException {
        JSONObject item = new JSONObject();
        item.put("id", result.id);
        item.put("name", source.getString("name"));
        item.put("mimeType", source.getString("mimeType"));
        item.put("size", result.size);
        item.put("sha256", result.sha256);
        item.put("path", result.path);
        item.put("createdAt", source.getString("createdAt"));
        item.put("updatedAt", source.getString("updatedAt"));
        return item;
    }

    private void remapPayloadReferences(JSONObject payload, Map<String, String> repairedIds) throws JSONException {
        JSONArray records = payload.optJSONArray("records");
        if (records != null) {
            for (int index = 0; index < records.length(); index += 1) remapImages(records.getJSONObject(index).optJSONArray("images"), repairedIds);
        }
        JSONArray plans = payload.optJSONArray("reimbursementPlans");
        if (plans != null) {
            for (int planIndex = 0; planIndex < plans.length(); planIndex += 1) {
                JSONArray materials = plans.getJSONObject(planIndex).optJSONArray("materials");
                if (materials == null) continue;
                for (int materialIndex = 0; materialIndex < materials.length(); materialIndex += 1) {
                    remapImages(materials.getJSONObject(materialIndex).optJSONArray("attachments"), repairedIds);
                }
            }
        }
    }

    private void remapImages(JSONArray images, Map<String, String> repairedIds) throws JSONException {
        if (images == null) return;
        for (int index = 0; index < images.length(); index += 1) {
            JSONObject image = images.getJSONObject(index);
            String assetId = image.optString("assetId", "");
            String repaired = repairedIds.get(assetId);
            if (repaired != null) image.put("assetId", repaired);
            image.put("dataUrl", "");
            image.remove("storagePath");
            image.remove("localUri");
            image.remove("sourceUri");
            image.remove("sourceKey");
            image.remove("relativePath");
            image.remove("visualFingerprint");
        }
    }

    private void assertEntityLimits(JSONObject payload) throws IOException {
        String[] arrayNames = { "events", "chemotherapyTemplates", "records", "pins", "reimbursementPlans", "assets" };
        for (String name : arrayNames) {
            JSONArray values = payload.optJSONArray(name);
            if (values != null && values.length() > MAX_ENTITY_COUNT) throw new IOException("备份数据过多");
        }
    }

    private File resolvePrivateFile(String storagePath) throws IOException {
        File root = new File(getContext().getFilesDir(), PrivateImageStore.DIRECTORY).getCanonicalFile();
        File target = new File(getContext().getFilesDir(), storagePath).getCanonicalFile();
        if (!target.getPath().startsWith(root.getPath() + File.separator)) throw new IOException("素材文件地址无效");
        return target;
    }

    private void copyToUri(File source, Uri targetUri) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        try (FileInputStream input = new FileInputStream(source);
             OutputStream output = resolver.openOutputStream(targetUri, "w")) {
            if (output == null) throw new IOException("无法写入所选文件");
            byte[] buffer = new byte[BUFFER_SIZE];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            output.flush();
        }
    }

    private void deleteSafDocument(Uri uri) {
        try {
            DocumentsContract.deleteDocument(getContext().getContentResolver(), uri);
        } catch (Exception error) {
            android.util.Log.w("BackupZipPlugin", "Unable to delete failed backup document", error);
        }
    }

    private static void validateMagic(byte[] bytes, int length, String mimeType) throws IOException {
        if ("image/jpeg".equals(mimeType)) {
            if (length < 3 || (bytes[0] & 0xff) != 0xff || (bytes[1] & 0xff) != 0xd8 || (bytes[2] & 0xff) != 0xff) throw new IOException("备份素材类型无效");
            return;
        }
        if ("image/png".equals(mimeType)) {
            int[] signature = { 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a };
            if (length < signature.length) throw new IOException("备份素材类型无效");
            for (int index = 0; index < signature.length; index += 1) if ((bytes[index] & 0xff) != signature[index]) throw new IOException("备份素材类型无效");
            return;
        }
        if ("image/gif".equals(mimeType)) {
            boolean gif87 = ascii(bytes, length, "GIF87a");
            boolean gif89 = ascii(bytes, length, "GIF89a");
            if (!gif87 && !gif89) throw new IOException("备份素材类型无效");
            return;
        }
        if ("image/webp".equals(mimeType)) {
            if (length < 12 || !ascii(bytes, length, "RIFF") || bytes[8] != 0x57 || bytes[9] != 0x45 || bytes[10] != 0x42 || bytes[11] != 0x50) throw new IOException("备份素材类型无效");
            return;
        }
        if ("application/pdf".equals(mimeType)) {
            if (!ascii(bytes, length, "%PDF-")) throw new IOException("备份素材类型无效");
            return;
        }
        if ("image/heic".equals(mimeType) || "image/heif".equals(mimeType)) {
            if (length < 12 || bytes[4] != 0x66 || bytes[5] != 0x74 || bytes[6] != 0x79 || bytes[7] != 0x70) throw new IOException("备份素材类型无效");
            String brand = new String(bytes, 8, 4, java.nio.charset.StandardCharsets.US_ASCII);
            if (!HEIF_BRANDS.contains(brand)) throw new IOException("备份素材类型无效");
            return;
        }
        throw new IOException("备份素材类型无效");
    }

    private static boolean ascii(byte[] bytes, int length, String value) {
        if (length < value.length()) return false;
        for (int index = 0; index < value.length(); index += 1) if (bytes[index] != (byte) value.charAt(index)) return false;
        return true;
    }

    private static String extensionFor(String mimeType) throws IOException {
        if ("image/jpeg".equals(mimeType)) return "jpg";
        if ("image/png".equals(mimeType)) return "png";
        if ("image/webp".equals(mimeType)) return "webp";
        if ("image/gif".equals(mimeType)) return "gif";
        if ("image/heic".equals(mimeType)) return "heic";
        if ("image/heif".equals(mimeType)) return "heif";
        if ("application/pdf".equals(mimeType)) return "pdf";
        throw new IOException("备份素材类型无效");
    }

    private static MessageDigest sha256Digest() throws IOException {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException error) {
            throw new IOException("设备不支持 SHA-256", error);
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) builder.append(String.format(Locale.ROOT, "%02x", value));
        return builder.toString();
    }

    private static String safeFilename(String filename) {
        String clean = filename == null ? "carejournal-backup.zip" : filename.replaceAll("[\\\\/:*?\"<>|]", "-").trim();
        if (clean.isEmpty()) clean = "carejournal-backup.zip";
        return clean.toLowerCase(Locale.ROOT).endsWith(".zip") ? clean : clean + ".zip";
    }

    private static String safeMessage(Exception error) {
        return error.getMessage() == null || error.getMessage().trim().isEmpty()
            ? error.getClass().getSimpleName()
            : error.getMessage();
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
    }

    private static final class AssetResult {
        final String id;
        final String sha256;
        final long size;
        final String path;
        final boolean duplicate;
        final boolean emitted;

        AssetResult(String id, String sha256, long size, String path, boolean duplicate, boolean emitted) {
            this.id = id;
            this.sha256 = sha256;
            this.size = size;
            this.path = path;
            this.duplicate = duplicate;
            this.emitted = emitted;
        }
    }

    private static final class SaveStats {
        final int assetCount;

        SaveStats(int assetCount) {
            this.assetCount = assetCount;
        }
    }
}
