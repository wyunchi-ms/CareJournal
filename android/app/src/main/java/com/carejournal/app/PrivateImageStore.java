package com.carejournal.app;

import android.content.Context;
import android.net.Uri;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

final class PrivateImageStore {
    static final String DIRECTORY = "report-images";

    static final class StoredFile {
        final String mimeType;
        final String sha256;
        final String storagePath;
        final String localUri;

        StoredFile(String mimeType, String sha256, String storagePath, String localUri) {
            this.mimeType = mimeType;
            this.sha256 = sha256;
            this.storagePath = storagePath;
            this.localUri = localUri;
        }
    }

    private PrivateImageStore() {}

    static StoredFile storeDataUrl(
        Context context,
        String dataUrl,
        String preferredKey,
        String declaredMimeType
    ) throws IOException {
        if (dataUrl == null || dataUrl.trim().isEmpty()) throw new IOException("图片内容为空");
        int comma = dataUrl.indexOf(',');
        if (comma < 0) throw new IOException("图片 Base64 格式无效");
        String header = dataUrl.substring(0, comma);
        String mimeType = mimeTypeFromHeader(header, declaredMimeType);
        byte[] bytes;
        try {
            bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            throw new IOException("图片 Base64 无法解码", error);
        }
        return storeBytes(context, bytes, preferredKey, mimeType);
    }

    static StoredFile storeBytes(
        Context context,
        byte[] bytes,
        String preferredKey,
        String mimeType
    ) throws IOException {
        if (bytes == null || bytes.length == 0) throw new IOException("图片内容为空");
        String normalizedMimeType = normalizeMimeType(mimeType);
        String hash = preferredKey == null || preferredKey.trim().isEmpty() ? sha256(bytes) : preferredKey.trim();
        String safeKey = hash.replaceAll("[^A-Za-z0-9_-]", "");
        if (safeKey.isEmpty()) safeKey = sha256(bytes);

        File directory = new File(context.getFilesDir(), DIRECTORY);
        if (!directory.exists() && !directory.mkdirs()) throw new IOException("无法创建图片存储目录");
        String filename = safeKey + extensionFor(normalizedMimeType);
        File target = new File(directory, filename);
        if (!target.exists()) {
            File temporary = File.createTempFile("image-", ".tmp", directory);
            boolean completed = false;
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                output.write(bytes);
                output.flush();
                output.getFD().sync();
                if (!temporary.renameTo(target) && !target.exists()) {
                    throw new IOException("无法完成图片文件写入");
                }
                completed = true;
            } finally {
                if (!completed || temporary.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    temporary.delete();
                }
            }
        }
        String storagePath = DIRECTORY + "/" + filename;
        return new StoredFile(normalizedMimeType, hash, storagePath, Uri.fromFile(target).toString());
    }

    static byte[] readBytes(Context context, String storagePath) throws IOException {
        File target = resolve(context, storagePath);
        if (!target.isFile()) throw new IOException("本地图片文件不存在");
        try (FileInputStream input = new FileInputStream(target);
             ByteArrayOutputStream output = new ByteArrayOutputStream((int) Math.min(target.length(), 8 * 1024 * 1024))) {
            byte[] buffer = new byte[32 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            return output.toByteArray();
        }
    }

    static String dataUrl(String mimeType, byte[] bytes) {
        return "data:" + normalizeMimeType(mimeType) + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP);
    }

    private static File resolve(Context context, String storagePath) throws IOException {
        if (storagePath == null || storagePath.trim().isEmpty()) throw new IOException("缺少图片文件地址");
        File root = new File(context.getFilesDir(), DIRECTORY).getCanonicalFile();
        File target = new File(context.getFilesDir(), storagePath).getCanonicalFile();
        if (!target.getPath().startsWith(root.getPath() + File.separator)) {
            throw new IOException("图片文件地址无效");
        }
        return target;
    }

    private static String mimeTypeFromHeader(String header, String fallback) {
        if (header.startsWith("data:")) {
            int semicolon = header.indexOf(';');
            if (semicolon > 5) return normalizeMimeType(header.substring(5, semicolon));
        }
        return normalizeMimeType(fallback);
    }

    private static String normalizeMimeType(String mimeType) {
        if (mimeType == null) return "image/jpeg";
        String normalized = mimeType.trim().toLowerCase(Locale.ROOT);
        return normalized.startsWith("image/") ? normalized : "image/jpeg";
    }

    private static String extensionFor(String mimeType) {
        if ("image/png".equals(mimeType)) return ".png";
        if ("image/webp".equals(mimeType)) return ".webp";
        return ".jpg";
    }

    private static String sha256(byte[] value) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value);
            StringBuilder builder = new StringBuilder(hash.length * 2);
            for (byte item : hash) builder.append(String.format(Locale.ROOT, "%02x", item));
            return builder.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new IOException("设备不支持 SHA-256", error);
        }
    }
}
