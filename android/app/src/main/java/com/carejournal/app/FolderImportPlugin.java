package com.carejournal.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "FolderImport")
public class FolderImportPlugin extends Plugin {
    private static final int MAX_IMAGE_DIMENSION = 2200;
    private static final int JPEG_QUALITY = 86;
    private static final String[] DOCUMENT_COLUMNS = {
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED,
    };

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION |
            Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        Intent data = activityResult.getData();
        if (activityResult.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject result = new JSObject();
            result.put("cancelled", true);
            result.put("files", new JSArray());
            call.resolve(result);
            return;
        }

        Uri treeUri = data.getData();
        try {
            int grantedFlags = data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
            getContext().getContentResolver().takePersistableUriPermission(treeUri, grantedFlags);
        } catch (SecurityException error) {
            call.reject("无法保留该文件夹的读取权限，请重新选择", error);
            return;
        }

        executor.execute(() -> {
            try {
                List<FolderImage> images = new ArrayList<>();
                Set<String> visitedDirectories = new HashSet<>();
                String rootDocumentId = DocumentsContract.getTreeDocumentId(treeUri);
                String folderName = queryDisplayName(
                    DocumentsContract.buildDocumentUriUsingTree(treeUri, rootDocumentId)
                );
                scanDirectory(treeUri, rootDocumentId, "", visitedDirectories, images);
                images.sort(
                    Comparator.comparingLong((FolderImage image) -> image.lastModified)
                        .thenComparing(image -> image.relativePath, String.CASE_INSENSITIVE_ORDER)
                );

                JSArray files = new JSArray();
                for (FolderImage image : images) files.put(image.toJsObject());
                JSObject result = new JSObject();
                result.put("cancelled", false);
                result.put("folderName", folderName);
                result.put("files", files);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("扫描文件夹失败：" + safeMessage(error), error);
            }
        });
    }

    @PluginMethod
    public void loadImage(PluginCall call) {
        String uriValue = call.getString("uri");
        if (uriValue == null || uriValue.trim().isEmpty()) {
            call.reject("缺少图片地址");
            return;
        }
        executor.execute(() -> {
            Bitmap decoded = null;
            Bitmap oriented = null;
            Bitmap scaled = null;
            try {
                Uri uri = Uri.parse(uriValue);
                ContentResolver resolver = getContext().getContentResolver();
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                try (InputStream stream = resolver.openInputStream(uri)) {
                    if (stream == null) throw new IOException("无法打开图片");
                    BitmapFactory.decodeStream(stream, null, bounds);
                }
                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw new IOException("无法解析图片尺寸");

                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inSampleSize = calculateSampleSize(bounds.outWidth, bounds.outHeight);
                options.inPreferredConfig = Bitmap.Config.ARGB_8888;
                try (InputStream stream = resolver.openInputStream(uri)) {
                    if (stream == null) throw new IOException("无法打开图片");
                    decoded = BitmapFactory.decodeStream(stream, null, options);
                }
                if (decoded == null) throw new IOException("图片解码失败");

                int rotation = readRotation(resolver, uri);
                oriented = rotateBitmap(decoded, rotation);
                if (oriented != decoded) decoded = null;
                scaled = scaleBitmap(oriented);
                if (scaled != oriented) oriented = null;

                ByteArrayOutputStream output = new ByteArrayOutputStream();
                if (!scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)) {
                    throw new IOException("图片压缩失败");
                }
                byte[] jpeg = output.toByteArray();
                String hash = sha256(jpeg);
                PrivateImageStore.StoredFile stored = PrivateImageStore.storeBytes(
                    getContext(),
                    jpeg,
                    hash,
                    "image/jpeg"
                );
                JSObject result = new JSObject();
                result.put("mimeType", stored.mimeType);
                result.put("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(jpeg, Base64.NO_WRAP));
                result.put("sha256", stored.sha256);
                result.put("storagePath", stored.storagePath);
                result.put("localUri", stored.localUri);
                call.resolve(result);
            } catch (SecurityException error) {
                call.reject("文件夹读取权限已失效，请重新选择该文件夹", error);
            } catch (Exception error) {
                call.reject("读取图片失败：" + safeMessage(error), error);
            } finally {
                recycle(scaled);
                if (oriented != scaled) recycle(oriented);
                if (decoded != oriented && decoded != scaled) recycle(decoded);
            }
        });
    }

    private void scanDirectory(
        Uri treeUri,
        String documentId,
        String parentPath,
        Set<String> visitedDirectories,
        List<FolderImage> images
    ) throws IOException {
        if (!visitedDirectories.add(documentId)) return;
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, documentId);
        try (Cursor cursor = getContext().getContentResolver().query(childrenUri, DOCUMENT_COLUMNS, null, null, null)) {
            if (cursor == null) throw new IOException("无法读取文件夹内容");
            int idIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int nameIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int mimeIndex = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE);
            int sizeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
            int modifiedIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
            while (cursor.moveToNext()) {
                String childId = cursor.getString(idIndex);
                String name = cursor.getString(nameIndex);
                String mimeType = cursor.getString(mimeIndex);
                String relativePath = parentPath.isEmpty() ? name : parentPath + "/" + name;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mimeType)) {
                    scanDirectory(treeUri, childId, relativePath, visitedDirectories, images);
                } else if (isImage(name, mimeType)) {
                    Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childId);
                    long size = readLong(cursor, sizeIndex);
                    long lastModified = readLong(cursor, modifiedIndex);
                    String sourceKey = documentUri + "|" + size + "|" + lastModified;
                    images.add(new FolderImage(documentUri.toString(), name, mimeType, relativePath, size, lastModified, sourceKey));
                }
            }
        }
    }

    private String queryDisplayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(
            uri,
            new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME },
            null,
            null,
            null
        )) {
            return cursor != null && cursor.moveToFirst() ? cursor.getString(0) : "所选文件夹";
        } catch (Exception ignored) {
            return "所选文件夹";
        }
    }

    private static boolean isImage(String name, String mimeType) {
        if (mimeType != null && mimeType.toLowerCase(Locale.ROOT).startsWith("image/")) return true;
        return name != null && name.toLowerCase(Locale.ROOT).matches(".*\\.(jpe?g|png|webp|heic|heif)$");
    }

    private static long readLong(Cursor cursor, int index) {
        return index >= 0 && !cursor.isNull(index) ? cursor.getLong(index) : 0L;
    }

    private static int calculateSampleSize(int width, int height) {
        int sampleSize = 1;
        while (Math.max(width / (sampleSize * 2), height / (sampleSize * 2)) >= MAX_IMAGE_DIMENSION) {
            sampleSize *= 2;
        }
        return sampleSize;
    }

    private static int readRotation(ContentResolver resolver, Uri uri) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return 0;
        try (InputStream stream = resolver.openInputStream(uri)) {
            if (stream == null) return 0;
            int orientation = new ExifInterface(stream).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            );
            if (orientation == ExifInterface.ORIENTATION_ROTATE_90) return 90;
            if (orientation == ExifInterface.ORIENTATION_ROTATE_180) return 180;
            if (orientation == ExifInterface.ORIENTATION_ROTATE_270) return 270;
        } catch (IOException ignored) {
            return 0;
        }
        return 0;
    }

    private static Bitmap rotateBitmap(Bitmap source, int degrees) {
        if (degrees == 0) return source;
        Matrix matrix = new Matrix();
        matrix.postRotate(degrees);
        Bitmap rotated = Bitmap.createBitmap(source, 0, 0, source.getWidth(), source.getHeight(), matrix, true);
        if (rotated != source) source.recycle();
        return rotated;
    }

    private static Bitmap scaleBitmap(Bitmap source) {
        int width = source.getWidth();
        int height = source.getHeight();
        float ratio = Math.min(1f, (float) MAX_IMAGE_DIMENSION / Math.max(width, height));
        if (ratio >= 1f) return source;
        Bitmap scaled = Bitmap.createScaledBitmap(source, Math.round(width * ratio), Math.round(height * ratio), true);
        if (scaled != source) source.recycle();
        return scaled;
    }

    private static String sha256(byte[] value) throws NoSuchAlgorithmException {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value);
        StringBuilder hex = new StringBuilder(digest.length * 2);
        for (byte item : digest) hex.append(String.format(Locale.ROOT, "%02x", item));
        return hex.toString();
    }

    private static void recycle(Bitmap bitmap) {
        if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
    }

    private static String safeMessage(Exception error) {
        return error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
    }

    private static class FolderImage {
        final String uri;
        final String name;
        final String mimeType;
        final String relativePath;
        final long size;
        final long lastModified;
        final String sourceKey;

        FolderImage(String uri, String name, String mimeType, String relativePath, long size, long lastModified, String sourceKey) {
            this.uri = uri;
            this.name = name;
            this.mimeType = mimeType == null ? "image/*" : mimeType;
            this.relativePath = relativePath;
            this.size = size;
            this.lastModified = lastModified;
            this.sourceKey = sourceKey;
        }

        JSObject toJsObject() {
            JSObject object = new JSObject();
            object.put("uri", uri);
            object.put("name", name);
            object.put("mimeType", mimeType);
            object.put("relativePath", relativePath);
            object.put("size", size);
            object.put("lastModified", lastModified);
            object.put("sourceKey", sourceKey);
            return object;
        }
    }
}
