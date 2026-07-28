package com.carejournal.app;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NativeImageStorage")
public class ImageStoragePlugin extends Plugin {
    private static final String DATABASE_NAME = "carejournalSQLite.db";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void persistImage(PluginCall call) {
        String id = call.getString("id", "");
        String dataUrl = call.getString("dataUrl");
        String sha256 = call.getString("sha256", "");
        String mimeType = call.getString("mimeType", "image/jpeg");
        executor.execute(() -> {
            try {
                PrivateImageStore.StoredFile stored = PrivateImageStore.storeDataUrl(
                    getContext(),
                    dataUrl,
                    sha256.isEmpty() ? id : sha256,
                    mimeType
                );
                call.resolve(toJsObject(stored));
            } catch (Exception error) {
                call.reject("保存本地图片失败：" + safeMessage(error), error);
            }
        });
    }

    @PluginMethod
    public void readImage(PluginCall call) {
        String storagePath = call.getString("storagePath");
        executor.execute(() -> {
            try {
                byte[] bytes = PrivateImageStore.readBytes(getContext(), storagePath);
                String mimeType = mimeTypeForPath(storagePath);
                JSObject result = new JSObject();
                result.put("mimeType", mimeType);
                result.put("dataUrl", PrivateImageStore.dataUrl(mimeType, bytes));
                call.resolve(result);
            } catch (Exception error) {
                call.reject("读取本地图片失败：" + safeMessage(error), error);
            }
        });
    }

    @PluginMethod
    public void migrateLegacyImages(PluginCall call) {
        executor.execute(() -> {
            File databaseFile = getContext().getDatabasePath(DATABASE_NAME);
            if (!databaseFile.isFile()) {
                call.resolve(migrationResult(0, 0, 0, false));
                return;
            }

            int migratedEntities = 0;
            int migratedImages = 0;
            int failedEntities = 0;
            boolean compacted = false;
            SQLiteDatabase database = null;
            try {
                database = SQLiteDatabase.openDatabase(
                    databaseFile.getAbsolutePath(),
                    null,
                    SQLiteDatabase.OPEN_READWRITE
                );
                List<String> keys = legacyEntityKeys(database);
                for (String key : keys) {
                    try {
                        MigrationOutcome outcome = migrateEntity(database, key);
                        if (outcome.changed) {
                            migratedEntities += 1;
                            migratedImages += outcome.imageCount;
                        }
                    } catch (Exception ignored) {
                        // Leave the original Base64 JSON untouched. A later launch can retry it.
                        failedEntities += 1;
                    }
                }
                if (migratedEntities > 0 && failedEntities == 0) {
                    try {
                        database.execSQL("VACUUM");
                        compacted = true;
                    } catch (SQLiteException ignored) {
                        compacted = false;
                    }
                }
                call.resolve(migrationResult(migratedEntities, migratedImages, failedEntities, compacted));
            } catch (Exception error) {
                call.reject("迁移本地图片失败：" + safeMessage(error), error);
            } finally {
                if (database != null) database.close();
            }
        });
    }

    @PluginMethod
    public void garbageCollect(PluginCall call) {
        JSArray values = call.getArray("storagePaths", new JSArray());
        Set<String> keep = new HashSet<>();
        for (int index = 0; index < values.length(); index += 1) {
            String value = values.optString(index, "");
            if (value.startsWith(PrivateImageStore.DIRECTORY + "/")) keep.add(value);
        }
        executor.execute(() -> {
            int deleted = 0;
            File directory = new File(getContext().getFilesDir(), PrivateImageStore.DIRECTORY);
            File[] files = directory.listFiles();
            if (files != null) {
                for (File file : files) {
                    String storagePath = PrivateImageStore.DIRECTORY + "/" + file.getName();
                    if ((!keep.contains(storagePath) || file.getName().endsWith(".tmp")) && file.delete()) {
                        deleted += 1;
                    }
                }
            }
            JSObject result = new JSObject();
            result.put("deleted", deleted);
            call.resolve(result);
        });
    }

    private List<String> legacyEntityKeys(SQLiteDatabase database) {
        List<String> keys = new ArrayList<>();
        try (Cursor cursor = database.rawQuery(
            "SELECT key FROM entities WHERE kind IN ('record', 'ocrJob', 'reimbursementPlan') AND instr(payload, '\"dataUrl\":\"data:') > 0",
            null
        )) {
            while (cursor.moveToNext()) keys.add(cursor.getString(0));
        }
        return keys;
    }

    private MigrationOutcome migrateEntity(SQLiteDatabase database, String key) throws JSONException {
        String payload = null;
        try (Cursor cursor = database.rawQuery(
            "SELECT payload FROM entities WHERE key = ? LIMIT 1",
            new String[] { key }
        )) {
            if (cursor.moveToFirst()) payload = cursor.getString(0);
        }
        if (payload == null) return new MigrationOutcome(false, 0);

        JSONObject root = new JSONObject(payload);
        int imageCount = 0;
        if (key.startsWith("record:")) {
            JSONArray images = root.optJSONArray("images");
            if (images != null) {
                for (int index = 0; index < images.length(); index += 1) {
                    JSONObject image = images.optJSONObject(index);
                    if (image != null && migrateImage(image)) imageCount += 1;
                }
            }
        } else if (key.startsWith("ocrJob:")) {
            JSONObject image = root.optJSONObject("image");
            if (image != null && migrateImage(image)) imageCount += 1;
        } else if (key.startsWith("reimbursementPlan:")) {
            JSONArray materials = root.optJSONArray("materials");
            if (materials != null) {
                for (int materialIndex = 0; materialIndex < materials.length(); materialIndex += 1) {
                    JSONObject material = materials.optJSONObject(materialIndex);
                    if (material == null) continue;
                    JSONArray attachments = material.optJSONArray("attachments");
                    if (attachments == null) continue;
                    for (int attachmentIndex = 0; attachmentIndex < attachments.length(); attachmentIndex += 1) {
                        JSONObject attachment = attachments.optJSONObject(attachmentIndex);
                        if (attachment != null && migrateImage(attachment)) imageCount += 1;
                    }
                }
            }
        }
        if (imageCount == 0) return new MigrationOutcome(false, 0);

        ContentValues values = new ContentValues();
        values.put("payload", root.toString());
        database.update("entities", values, "key = ?", new String[] { key });
        return new MigrationOutcome(true, imageCount);
    }

    private boolean migrateImage(JSONObject image) throws JSONException {
        String dataUrl = image.optString("dataUrl", "");
        if (dataUrl.isEmpty()) return false;
        try {
            PrivateImageStore.StoredFile stored = PrivateImageStore.storeDataUrl(
                getContext(),
                dataUrl,
                image.optString("sha256", image.optString("id", "")),
                image.optString("mimeType", "image/jpeg")
            );
            image.put("mimeType", stored.mimeType);
            image.put("sha256", stored.sha256);
            image.put("storagePath", stored.storagePath);
            image.put("localUri", stored.localUri);
            image.put("dataUrl", "");
            return true;
        } catch (Exception error) {
            throw new JSONException(safeMessage(error));
        }
    }

    private static JSObject toJsObject(PrivateImageStore.StoredFile stored) {
        JSObject result = new JSObject();
        result.put("mimeType", stored.mimeType);
        result.put("sha256", stored.sha256);
        result.put("storagePath", stored.storagePath);
        result.put("localUri", stored.localUri);
        return result;
    }

    private static JSObject migrationResult(
        int migratedEntities,
        int migratedImages,
        int failedEntities,
        boolean compacted
    ) {
        JSObject result = new JSObject();
        result.put("migratedEntities", migratedEntities);
        result.put("migratedImages", migratedImages);
        result.put("failedEntities", failedEntities);
        result.put("compacted", compacted);
        return result;
    }

    private static String mimeTypeForPath(String storagePath) {
        if (storagePath != null && storagePath.toLowerCase().endsWith(".pdf")) return "application/pdf";
        if (storagePath != null && storagePath.toLowerCase().endsWith(".png")) return "image/png";
        if (storagePath != null && storagePath.toLowerCase().endsWith(".webp")) return "image/webp";
        return "image/jpeg";
    }

    private static String safeMessage(Exception error) {
        return error.getMessage() == null || error.getMessage().trim().isEmpty()
            ? error.getClass().getSimpleName()
            : error.getMessage();
    }

    private static final class MigrationOutcome {
        final boolean changed;
        final int imageCount;

        MigrationOutcome(boolean changed, int imageCount) {
            this.changed = changed;
            this.imageCount = imageCount;
        }
    }
}
