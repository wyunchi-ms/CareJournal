package com.carejournal.app;

import android.content.Context;
import android.net.wifi.WifiManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "LanSync")
public class LanSyncPlugin extends Plugin {
    private static final String MULTICAST_ADDRESS = "224.0.0.167";
    private static final String BROADCAST_ADDRESS = "255.255.255.255";
    private static final int PORT = 53318;
    private static final long PEER_TTL_MS = 16000;
    private static final int MAX_BODY_BYTES = 300 * 1024 * 1024;

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private ScheduledExecutorService scheduler;
    private final Map<String, Peer> peers = new ConcurrentHashMap<>();
    private final Map<String, PendingRequest> pending = new ConcurrentHashMap<>();
    private volatile boolean active = false;
    private String alias = "CareJournal 手机";
    private String publicKey = "";
    private String fingerprint = "";
    private ServerSocket serverSocket;
    private MulticastSocket multicastSocket;
    private WifiManager.MulticastLock multicastLock;

    @PluginMethod
    public void start(PluginCall call) {
        alias = call.getString("alias", "CareJournal 手机");
        publicKey = call.getString("publicKey", "");
        if (publicKey.isEmpty()) {
            call.reject("无法开启局域网同步：设备加密密钥无效");
            return;
        }
        executor.execute(() -> {
            try {
                stopInternal();
                fingerprint = getContext().getSharedPreferences("carejournal_lan", Context.MODE_PRIVATE)
                    .getString("fingerprint", "");
                if (fingerprint.isEmpty()) {
                    fingerprint = UUID.randomUUID().toString();
                    getContext().getSharedPreferences("carejournal_lan", Context.MODE_PRIVATE)
                        .edit().putString("fingerprint", fingerprint).apply();
                }
                active = true;
                startHttpServer();
                startDiscovery();
                call.resolve(serviceInfo());
            } catch (Exception error) {
                stopInternal();
                call.reject("无法开启局域网同步：" + safeMessage(error), error);
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        executor.execute(() -> {
            stopInternal();
            call.resolve();
        });
    }

    @PluginMethod
    public void refresh(PluginCall call) {
        if (!active) {
            call.reject("局域网同步尚未开启");
            return;
        }
        announce(true);
        call.resolve();
    }

    @PluginMethod
    public void listPeers(PluginCall call) {
        JSObject result = new JSObject();
        result.put("peers", peerArray());
        call.resolve(result);
    }

    @PluginMethod
    public void completeSync(PluginCall call) {
        String requestId = call.getString("requestId", "");
        PendingRequest request = pending.get(requestId);
        if (request == null) {
            call.reject("同步请求已失效");
            return;
        }
        request.resultEnvelope = call.getString("envelope", "");
        call.resolve();
    }

    @PluginMethod
    public void rejectSync(PluginCall call) {
        String requestId = call.getString("requestId", "");
        PendingRequest request = pending.get(requestId);
        if (request == null) {
            call.reject("同步请求已失效");
            return;
        }
        request.error = call.getString("error", "接收方拒绝了同步");
        call.resolve();
    }

    @PluginMethod
    public void sendSync(PluginCall call) {
        String host = call.getString("host", "");
        Integer remotePort = call.getInt("port", PORT);
        String envelope = call.getString("envelope", "");
        executor.execute(() -> {
            try {
                boolean known = currentPeers().stream().anyMatch(peer -> peer.host.equals(host) && peer.port == remotePort);
                if (!known) throw new IOException("目标设备不在当前发现列表中，请刷新后重试");
                String base = "http://" + host + ":" + remotePort;
                JSONObject created = requestJson("POST", base + "/carejournal/v1/sync", envelope, 30000);
                String requestId = created.getString("requestId");
                long deadline = System.currentTimeMillis() + 120000;
                while (System.currentTimeMillis() < deadline) {
                    Thread.sleep(850);
                    HttpResult result = rawRequest("GET", base + "/carejournal/v1/result/" + requestId, null, 10000);
                    JSONObject body = new JSONObject(result.body);
                    if (result.status == 202) continue;
                    if (result.status < 200 || result.status >= 300) {
                        throw new IOException(body.optString("error", "对方设备未能完成同步"));
                    }
                    JSObject response = new JSObject();
                    response.put("envelope", body.getString("envelope"));
                    call.resolve(response);
                    return;
                }
                throw new IOException("等待对方完成同步超时");
            } catch (Exception error) {
                call.reject("局域网同步失败：" + safeMessage(error), error);
            }
        });
    }

    private void startHttpServer() throws IOException {
        serverSocket = new ServerSocket();
        serverSocket.setReuseAddress(true);
        serverSocket.bind(new InetSocketAddress(PORT));
        executor.execute(() -> {
            while (active && serverSocket != null && !serverSocket.isClosed()) {
                try {
                    Socket socket = serverSocket.accept();
                    executor.execute(() -> handleHttp(socket));
                } catch (IOException error) {
                    if (active) error.printStackTrace();
                }
            }
        });
    }

    private void handleHttp(Socket socket) {
        try (Socket client = socket;
             BufferedInputStream input = new BufferedInputStream(client.getInputStream());
             BufferedOutputStream output = new BufferedOutputStream(client.getOutputStream())) {
            String headers = readHeaders(input);
            String[] headerLines = headers.split("\\r\\n");
            String[] requestLine = headerLines[0].split(" ");
            String method = requestLine[0];
            String path = requestLine.length > 1 ? requestLine[1] : "/";
            int contentLength = 0;
            for (String header : headerLines) {
                if (header.toLowerCase().startsWith("content-length:")) {
                    contentLength = Integer.parseInt(header.substring(header.indexOf(':') + 1).trim());
                }
            }
            if (contentLength > MAX_BODY_BYTES) {
                writeResponse(output, 413, new JSONObject().put("error", "同步数据过大").toString());
                return;
            }
            byte[] bodyBytes = readBytes(input, contentLength);
            String body = new String(bodyBytes, StandardCharsets.UTF_8);
            if ("OPTIONS".equals(method)) {
                writeResponse(output, 204, "");
                return;
            }
            if ("POST".equals(method) && "/carejournal/v1/sync".equals(path)) {
                new JSONObject(body);
                String requestId = UUID.randomUUID().toString();
                PendingRequest request = new PendingRequest(requestId, body);
                pending.put(requestId, request);
                JSObject event = new JSObject();
                event.put("requestId", requestId);
                event.put("envelope", body);
                event.put("peerAddress", client.getInetAddress().getHostAddress());
                notifyListeners("syncRequest", event);
                writeResponse(output, 202, new JSONObject().put("requestId", requestId).toString());
                return;
            }
            if ("GET".equals(method) && path.startsWith("/carejournal/v1/result/")) {
                String requestId = path.substring("/carejournal/v1/result/".length());
                PendingRequest request = pending.get(requestId);
                if (request == null || (request.resultEnvelope == null && request.error == null)) {
                    writeResponse(output, 202, new JSONObject().put("status", "pending").toString());
                } else if (request.error != null) {
                    pending.remove(requestId);
                    writeResponse(output, 409, new JSONObject().put("error", request.error).toString());
                } else {
                    pending.remove(requestId);
                    writeResponse(output, 200, new JSONObject().put("envelope", request.resultEnvelope).toString());
                }
                return;
            }
            writeResponse(output, 404, new JSONObject().put("error", "Not found").toString());
        } catch (Exception ignored) {
            // A malformed LAN request must not interrupt discovery or the app.
        }
    }

    private void startDiscovery() throws IOException {
        WifiManager wifiManager = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        multicastLock = wifiManager.createMulticastLock("carejournal-lan-sync");
        multicastLock.setReferenceCounted(false);
        multicastLock.acquire();

        multicastSocket = new MulticastSocket(null);
        multicastSocket.setReuseAddress(true);
        multicastSocket.setBroadcast(true);
        multicastSocket.bind(new InetSocketAddress(PORT));
        multicastSocket.setTimeToLive(1);
        multicastSocket.joinGroup(InetAddress.getByName(MULTICAST_ADDRESS));
        executor.execute(() -> {
            byte[] buffer = new byte[4096];
            while (active && multicastSocket != null && !multicastSocket.isClosed()) {
                try {
                    java.net.DatagramPacket packet = new java.net.DatagramPacket(buffer, buffer.length);
                    multicastSocket.receive(packet);
                    JSONObject advertisement = new JSONObject(new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8));
                    if (!"carejournal".equals(advertisement.optString("app")) || advertisement.optInt("version") != 2) continue;
                    String remoteFingerprint = advertisement.optString("fingerprint");
                    String remotePublicKey = advertisement.optString("publicKey");
                    if (remoteFingerprint.isEmpty() || remotePublicKey.isEmpty() || remoteFingerprint.equals(fingerprint)) continue;
                    peers.put(remoteFingerprint, new Peer(
                        remoteFingerprint,
                        advertisement.optString("alias", "CareJournal 设备"),
                        "web".equals(advertisement.optString("deviceType")) ? "web" : "mobile",
                        remotePublicKey,
                        packet.getAddress().getHostAddress(),
                        advertisement.optInt("port", PORT),
                        System.currentTimeMillis()
                    ));
                    notifyPeers();
                    if (advertisement.optBoolean("announce")) announce(false);
                } catch (Exception error) {
                    if (active) error.printStackTrace();
                }
            }
        });
        scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleAtFixedRate(() -> announce(false), 0, 5, TimeUnit.SECONDS);
        announce(true);
    }

    private void announce(boolean requestResponse) {
        try {
            if (!active || multicastSocket == null) return;
            JSONObject advertisement = new JSONObject()
                .put("app", "carejournal")
                .put("version", 2)
                .put("alias", alias)
                .put("deviceType", "mobile")
                .put("fingerprint", fingerprint)
                .put("publicKey", publicKey)
                .put("port", PORT)
                .put("announce", requestResponse);
            byte[] data = advertisement.toString().getBytes(StandardCharsets.UTF_8);
            java.net.DatagramPacket packet = new java.net.DatagramPacket(
                data, data.length, InetAddress.getByName(MULTICAST_ADDRESS), PORT);
            multicastSocket.send(packet);
            java.net.DatagramPacket broadcastPacket = new java.net.DatagramPacket(
                data, data.length, InetAddress.getByName(BROADCAST_ADDRESS), PORT);
            multicastSocket.send(broadcastPacket);
        } catch (Exception ignored) {
            // A later scheduled announcement can recover from transient Wi-Fi changes.
        }
    }

    private void notifyPeers() {
        JSObject event = new JSObject();
        event.put("peers", peerArray());
        notifyListeners("peersChanged", event);
    }

    private JSArray peerArray() {
        JSArray array = new JSArray();
        for (Peer peer : currentPeers()) array.put(peer.toJs());
        return array;
    }

    private List<Peer> currentPeers() {
        long cutoff = System.currentTimeMillis() - PEER_TTL_MS;
        peers.entrySet().removeIf(entry -> entry.getValue().lastSeen < cutoff);
        List<Peer> result = new ArrayList<>(peers.values());
        result.sort(Comparator.comparingLong((Peer peer) -> peer.lastSeen).reversed());
        return result;
    }

    private JSObject serviceInfo() {
        JSObject result = new JSObject();
        result.put("alias", alias);
        result.put("fingerprint", fingerprint);
        result.put("publicKey", publicKey);
        result.put("port", PORT);
        result.put("transport", "native");
        return result;
    }

    private void stopInternal() {
        active = false;
        if (scheduler != null) scheduler.shutdownNow();
        scheduler = null;
        if (multicastSocket != null) multicastSocket.close();
        multicastSocket = null;
        if (serverSocket != null) {
            try { serverSocket.close(); } catch (IOException ignored) {}
        }
        serverSocket = null;
        if (multicastLock != null && multicastLock.isHeld()) multicastLock.release();
        multicastLock = null;
        peers.clear();
        pending.clear();
    }

    @Override
    protected void handleOnDestroy() {
        stopInternal();
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private static String readHeaders(BufferedInputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        int matched = 0;
        int value;
        while ((value = input.read()) != -1 && output.size() < 32768) {
            output.write(value);
            int[] ending = { '\r', '\n', '\r', '\n' };
            matched = value == ending[matched] ? matched + 1 : (value == '\r' ? 1 : 0);
            if (matched == 4) return output.toString(StandardCharsets.UTF_8.name());
        }
        throw new IOException("HTTP 请求头无效");
    }

    private static byte[] readBytes(BufferedInputStream input, int length) throws IOException {
        byte[] body = new byte[length];
        int offset = 0;
        while (offset < length) {
            int count = input.read(body, offset, length - offset);
            if (count < 0) throw new IOException("HTTP 请求内容不完整");
            offset += count;
        }
        return body;
    }

    private static void writeResponse(BufferedOutputStream output, int status, String body) throws IOException {
        byte[] data = body.getBytes(StandardCharsets.UTF_8);
        String reason = status == 200 ? "OK" : status == 202 ? "Accepted" : status == 204 ? "No Content" : "Error";
        String headers = "HTTP/1.1 " + status + " " + reason + "\r\n"
            + "Content-Type: application/json; charset=utf-8\r\n"
            + "Content-Length: " + data.length + "\r\n"
            + "Cache-Control: no-store\r\n"
            + "Access-Control-Allow-Origin: *\r\n"
            + "Connection: close\r\n\r\n";
        output.write(headers.getBytes(StandardCharsets.UTF_8));
        output.write(data);
        output.flush();
    }

    private static JSONObject requestJson(String method, String url, String body, int timeout) throws Exception {
        HttpResult result = rawRequest(method, url, body, timeout);
        JSONObject json = new JSONObject(result.body);
        if (result.status < 200 || result.status >= 300) throw new IOException(json.optString("error", "远程设备返回 " + result.status));
        return json;
    }

    private static HttpResult rawRequest(String method, String url, String body, int timeout) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(timeout);
        connection.setReadTimeout(timeout);
        connection.setRequestProperty("Content-Type", "application/json");
        if (body != null) {
            connection.setDoOutput(true);
            byte[] data = body.getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(data.length);
            try (BufferedOutputStream output = new BufferedOutputStream(connection.getOutputStream())) {
                output.write(data);
            }
        }
        int status = connection.getResponseCode();
        java.io.InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        if (stream != null) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = stream.read(buffer)) >= 0) output.write(buffer, 0, count);
            stream.close();
        }
        connection.disconnect();
        return new HttpResult(status, output.toString(StandardCharsets.UTF_8.name()));
    }

    private static String safeMessage(Exception error) {
        return error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
    }

    private static class Peer {
        final String fingerprint;
        final String alias;
        final String deviceType;
        final String publicKey;
        final String host;
        final int port;
        final long lastSeen;

        Peer(String fingerprint, String alias, String deviceType, String publicKey, String host, int port, long lastSeen) {
            this.fingerprint = fingerprint;
            this.alias = alias;
            this.deviceType = deviceType;
            this.publicKey = publicKey;
            this.host = host;
            this.port = port;
            this.lastSeen = lastSeen;
        }

        JSObject toJs() {
            JSObject result = new JSObject();
            result.put("fingerprint", fingerprint);
            result.put("alias", alias);
            result.put("deviceType", deviceType);
            result.put("publicKey", publicKey);
            result.put("host", host);
            result.put("port", port);
            result.put("lastSeen", lastSeen);
            return result;
        }
    }

    private static class PendingRequest {
        final String requestId;
        final String envelope;
        volatile String resultEnvelope;
        volatile String error;

        PendingRequest(String requestId, String envelope) {
            this.requestId = requestId;
            this.envelope = envelope;
        }
    }

    private static class HttpResult {
        final int status;
        final String body;

        HttpResult(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }
}
