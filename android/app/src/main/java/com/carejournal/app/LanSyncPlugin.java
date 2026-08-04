package com.carejournal.app;

import android.content.ContentResolver;
import android.content.Context;
import android.net.DhcpInfo;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.provider.Settings;

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
import java.net.Inet4Address;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
    private static final String NSD_SERVICE_TYPE = "_carejournal._tcp.";
    private static final String NSD_APP = "carejournal";
    private static final String NSD_VERSION = "4";
    private static final int PORT = 53318;
    private static final long PEER_TTL_MS = 90000;
    private static final long PENDING_TTL_MS = 125000;
    private static final int MAX_BODY_BYTES = 300 * 1024 * 1024;
    private static final int NSD_ALIAS_TARGET_BYTES = 160;
    private static final int NSD_TXT_TARGET_BYTES = 400;

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
    private NsdManager nsdManager;
    private NsdManager.RegistrationListener nsdRegistrationListener;
    private NsdManager.DiscoveryListener nsdDiscoveryListener;
    private final Set<String> resolvingNsdServices = ConcurrentHashMap.newKeySet();

    @PluginMethod
    public void start(PluginCall call) {
        alias = resolvedAlias(call.getString("alias", ""));
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
        refreshNsd();
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
                String base = "http://" + hostForUrl(host) + ":" + remotePort;
                JSONObject created = requestJson("POST", base + "/carejournal/v1/sync", envelope, 30000);
                String requestId = created.getString("requestId");
                long deadline = System.currentTimeMillis() + 120000;
                while (System.currentTimeMillis() < deadline) {
                    Thread.sleep(25);
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

    @PluginMethod
    public void setTransferActive(PluginCall call) {
        try {
            if (Boolean.TRUE.equals(call.getBoolean("active", false))) {
                LanSyncForegroundService.start(getContext());
            } else {
                LanSyncForegroundService.stop(getContext());
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("无法更新后台同步状态：" + safeMessage(error), error);
        }
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
                JSONObject envelope = new JSONObject(body);
                String remotePublicKey = envelope.optString("senderPublicKey", "");
                String remoteFingerprint = headerValue(headerLines, "x-carejournal-fingerprint");
                String remoteAlias = decodeHeader(headerValue(headerLines, "x-carejournal-alias"));
                if (!remotePublicKey.isEmpty()) {
                    if (remoteFingerprint.isEmpty()) remoteFingerprint = remotePublicKey.substring(0, Math.min(32, remotePublicKey.length()));
                    if (remoteAlias.isEmpty()) remoteAlias = "CareJournal 设备";
                    peers.put(remoteFingerprint, new Peer(
                        remoteFingerprint,
                        remoteAlias,
                        "mobile",
                        remotePublicKey,
                        client.getInetAddress().getHostAddress(),
                        PORT,
                        System.currentTimeMillis()
                    ));
                    notifyPeers();
                }
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
                expirePending();
                String requestId = path.substring("/carejournal/v1/result/".length());
                PendingRequest request = pending.get(requestId);
                if (request == null) {
                    writeResponse(output, 410, new JSONObject().put("error", "同步请求已失效").toString());
                } else if (request.resultEnvelope == null && request.error == null) {
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
        if (wifiManager != null) {
            try {
                multicastLock = wifiManager.createMulticastLock("carejournal-lan-sync");
                multicastLock.setReferenceCounted(false);
                multicastLock.acquire();
            } catch (Exception ignored) {
                multicastLock = null;
            }
        }

        multicastSocket = new MulticastSocket(null);
        multicastSocket.setReuseAddress(true);
        multicastSocket.setBroadcast(true);
        multicastSocket.bind(new InetSocketAddress(PORT));
        multicastSocket.setTimeToLive(1);
        try {
            multicastSocket.joinGroup(InetAddress.getByName(MULTICAST_ADDRESS));
        } catch (Exception ignored) {
            // Broadcast discovery remains available when a vendor blocks multicast.
        }
        executor.execute(() -> {
            byte[] buffer = new byte[4096];
            while (active && multicastSocket != null && !multicastSocket.isClosed()) {
                try {
                    java.net.DatagramPacket packet = new java.net.DatagramPacket(buffer, buffer.length);
                    multicastSocket.receive(packet);
                    JSONObject advertisement = new JSONObject(new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8));
                    if (!"carejournal".equals(advertisement.optString("app")) || advertisement.optInt("version") != 4) continue;
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
                    // Reply directly to the sender as well as through
                    // broadcast. Some vendor Wi-Fi stacks deliver broadcast
                    // in only one direction, while unicast remains reliable.
                    if (advertisement.optBoolean("announce")) {
                        announceTo(packet.getAddress());
                        announce(false);
                    }
                } catch (Exception error) {
                    if (active) error.printStackTrace();
                }
            }
        });
        scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleAtFixedRate(() -> announce(false), 0, 5, TimeUnit.SECONDS);
        announce(true);
        startNsd();
    }

    private void startNsd() {
        if (!active || serverSocket == null || serverSocket.isClosed()) return;
        try {
            nsdManager = (NsdManager) getContext().getApplicationContext().getSystemService(Context.NSD_SERVICE);
        } catch (RuntimeException error) {
            nsdManager = null;
        }
        if (nsdManager == null) return;
        registerNsdService();
        discoverNsdServices();
    }

    private void refreshNsd() {
        executor.execute(() -> {
            stopNsd();
            if (active) startNsd();
        });
    }

    private void registerNsdService() {
        if (nsdManager == null || nsdRegistrationListener != null) return;
        NsdServiceInfo serviceInfo = new NsdServiceInfo();
        serviceInfo.setServiceType(NSD_SERVICE_TYPE);
        serviceInfo.setServiceName(nsdServiceName(fingerprint));
        serviceInfo.setPort(PORT);
        try {
            addNsdAttributes(serviceInfo, alias);
        } catch (IllegalArgumentException error) {
            return;
        }
        nsdRegistrationListener = new NsdManager.RegistrationListener() {
            @Override
            public void onServiceRegistered(NsdServiceInfo serviceInfo) {}

            @Override
            public void onRegistrationFailed(NsdServiceInfo serviceInfo, int errorCode) {
                nsdRegistrationListener = null;
            }

            @Override
            public void onServiceUnregistered(NsdServiceInfo serviceInfo) {}

            @Override
            public void onUnregistrationFailed(NsdServiceInfo serviceInfo, int errorCode) {}
        };
        try {
            nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, nsdRegistrationListener);
        } catch (RuntimeException error) {
            nsdRegistrationListener = null;
        }
    }

    private void discoverNsdServices() {
        if (nsdManager == null || nsdDiscoveryListener != null) return;
        nsdDiscoveryListener = new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String serviceType) {}

            @Override
            public void onServiceFound(NsdServiceInfo serviceInfo) {
                if (!active || serviceInfo == null || !NSD_SERVICE_TYPE.equals(serviceInfo.getServiceType())) return;
                resolveNsdService(serviceInfo);
            }

            @Override
            public void onServiceLost(NsdServiceInfo serviceInfo) {}

            @Override
            public void onDiscoveryStopped(String serviceType) {}

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                stopNsdDiscovery();
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                stopNsdDiscovery();
            }
        };
        try {
            nsdManager.discoverServices(NSD_SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, nsdDiscoveryListener);
        } catch (RuntimeException error) {
            nsdDiscoveryListener = null;
        }
    }

    private void resolveNsdService(NsdServiceInfo serviceInfo) {
        String serviceName = serviceInfo.getServiceName();
        if (serviceName == null) return;
        if (!resolvingNsdServices.add(serviceName)) return;
        NsdManager.ResolveListener listener = new NsdManager.ResolveListener() {
            @Override
            public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {
                resolvingNsdServices.remove(serviceName);
            }

            @Override
            public void onServiceResolved(NsdServiceInfo resolved) {
                resolvingNsdServices.remove(serviceName);
                handleResolvedNsdService(resolved);
            }
        };
        try {
            nsdManager.resolveService(serviceInfo, listener);
        } catch (RuntimeException error) {
            resolvingNsdServices.remove(serviceName);
        }
    }

    private void handleResolvedNsdService(NsdServiceInfo resolved) {
        if (!active || resolved == null) return;
        NsdPeerRecord record = parseNsdPeerRecord(resolved);
        if (record == null) return;
        peers.put(record.fingerprint, new Peer(
            record.fingerprint,
            record.alias,
            record.deviceType,
            record.publicKey,
            record.host,
            record.port,
            System.currentTimeMillis()
        ));
        notifyPeers();
    }

    private void stopNsd() {
        stopNsdDiscovery();
        if (nsdManager != null && nsdRegistrationListener != null) {
            try {
                nsdManager.unregisterService(nsdRegistrationListener);
            } catch (IllegalArgumentException | IllegalStateException ignored) {
                // Listener was not registered or Android NSD has already torn it down.
            }
        }
        nsdRegistrationListener = null;
        nsdManager = null;
        resolvingNsdServices.clear();
    }

    private void stopNsdDiscovery() {
        if (nsdManager != null && nsdDiscoveryListener != null) {
            try {
                nsdManager.stopServiceDiscovery(nsdDiscoveryListener);
            } catch (IllegalArgumentException | IllegalStateException ignored) {
                // Listener was not active or Android NSD has already stopped it.
            }
        }
        nsdDiscoveryListener = null;
    }

    private void announce(boolean requestResponse) {
        if (!active || multicastSocket == null) return;
        try {
            JSONObject advertisement = new JSONObject()
                .put("app", "carejournal")
                .put("version", 4)
                .put("alias", alias)
                .put("deviceType", "mobile")
                .put("fingerprint", fingerprint)
                .put("publicKey", publicKey)
                .put("port", PORT)
                .put("announce", requestResponse);
            byte[] data = advertisement.toString().getBytes(StandardCharsets.UTF_8);
            // Some Android vendors reject multicast sends even after the lock
            // is acquired. Each destination must be attempted independently so
            // that a multicast failure cannot suppress the broadcast fallback.
            sendAdvertisement(data, MULTICAST_ADDRESS);
            sendAdvertisement(data, BROADCAST_ADDRESS);
            InetAddress directedBroadcast = wifiBroadcastAddress();
            if (directedBroadcast != null && !BROADCAST_ADDRESS.equals(directedBroadcast.getHostAddress())) {
                sendAdvertisement(data, directedBroadcast.getHostAddress());
            }
        } catch (Exception ignored) {}
    }

    private void sendAdvertisement(byte[] data, String address) {
        try {
            MulticastSocket socket = multicastSocket;
            if (!active || socket == null || socket.isClosed()) return;
            socket.send(new java.net.DatagramPacket(
                data, data.length, InetAddress.getByName(address), PORT));
        } catch (Exception ignored) {
            // Other destinations and later scheduled announcements can recover.
        }
    }

    private void announceTo(InetAddress address) {
        if (!active || address == null || multicastSocket == null) return;
        try {
            JSONObject advertisement = new JSONObject()
                .put("app", "carejournal")
                .put("version", 4)
                .put("alias", alias)
                .put("deviceType", "mobile")
                .put("fingerprint", fingerprint)
                .put("publicKey", publicKey)
                .put("port", PORT)
                .put("announce", false);
            byte[] data = advertisement.toString().getBytes(StandardCharsets.UTF_8);
            multicastSocket.send(new java.net.DatagramPacket(data, data.length, address, PORT));
        } catch (Exception ignored) {}
    }

    private static String nsdServiceName(String fingerprint) {
        return nsdServiceNamePrefix(fingerprint) + "-" + UUID.randomUUID().toString().replace("-", "").substring(0, 4);
    }

    static String nsdServiceNamePrefix(String fingerprint) {
        String sanitized = fingerprint == null ? "" : fingerprint.replaceAll("[^A-Za-z0-9]", "").toLowerCase(java.util.Locale.ROOT);
        if (sanitized.length() > 8) sanitized = sanitized.substring(0, 8);
        while (sanitized.length() < 8) sanitized += "0";
        return "cj-" + sanitized;
    }

    private void addNsdAttributes(NsdServiceInfo serviceInfo, String sourceAlias) {
        String txtAlias = truncateUtf8(sourceAlias == null ? "" : sourceAlias, NSD_ALIAS_TARGET_BYTES);
        serviceInfo.setAttribute("app", NSD_APP);
        serviceInfo.setAttribute("v", NSD_VERSION);
        serviceInfo.setAttribute("fp", fingerprint);
        serviceInfo.setAttribute("pk", publicKey);
        serviceInfo.setAttribute("dt", "mobile");
        serviceInfo.setAttribute("alias", fitAliasForTxtBudget(txtAlias));
    }

    private String fitAliasForTxtBudget(String txtAlias) {
        int fixedBytes = txtEntryBytes("app", NSD_APP)
            + txtEntryBytes("v", NSD_VERSION)
            + txtEntryBytes("fp", fingerprint)
            + txtEntryBytes("pk", publicKey)
            + txtEntryBytes("dt", "mobile");
        int remaining = NSD_TXT_TARGET_BYTES - fixedBytes - "alias=".getBytes(StandardCharsets.UTF_8).length;
        if (remaining <= 0) return "";
        return truncateUtf8(txtAlias, Math.min(NSD_ALIAS_TARGET_BYTES, remaining));
    }

    private static int txtEntryBytes(String key, String value) {
        return (key + "=" + (value == null ? "" : value)).getBytes(StandardCharsets.UTF_8).length;
    }

    static String truncateUtf8(String value, int maxBytes) {
        if (value == null || maxBytes <= 0) return "";
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        if (bytes.length <= maxBytes) return value;
        int end = 0;
        int used = 0;
        while (end < value.length()) {
            int codePoint = value.codePointAt(end);
            int count = new String(Character.toChars(codePoint)).getBytes(StandardCharsets.UTF_8).length;
            if (used + count > maxBytes) break;
            used += count;
            end += Character.charCount(codePoint);
        }
        return value.substring(0, end);
    }

    NsdPeerRecord parseNsdPeerRecord(NsdServiceInfo serviceInfo) {
        if (serviceInfo == null) return null;
        if (!NSD_SERVICE_TYPE.equals(serviceInfo.getServiceType())) return null;
        int port = serviceInfo.getPort();
        if (port <= 0 || port > 65535) return null;
        String app = nsdAttribute(serviceInfo, "app");
        String version = nsdAttribute(serviceInfo, "v");
        String remoteFingerprint = nsdAttribute(serviceInfo, "fp");
        String remotePublicKey = nsdAttribute(serviceInfo, "pk");
        String deviceType = nsdAttribute(serviceInfo, "dt");
        String remoteAlias = nsdAttribute(serviceInfo, "alias");
        if (!NSD_APP.equals(app) || !NSD_VERSION.equals(version)) return null;
        if (remoteFingerprint.isEmpty() || remotePublicKey.isEmpty() || remoteAlias.isEmpty() || deviceType.isEmpty()) return null;
        if (remoteFingerprint.equals(fingerprint)) return null;
        InetAddress host = preferredNsdHost(serviceInfo);
        if (host == null) return null;
        return new NsdPeerRecord(
            remoteFingerprint,
            remoteAlias,
            "web".equals(deviceType) ? "web" : "mobile",
            remotePublicKey,
            host.getHostAddress(),
            port
        );
    }

    private static InetAddress preferredNsdHost(NsdServiceInfo serviceInfo) {
        if (Build.VERSION.SDK_INT >= 34) {
            List<InetAddress> hosts = serviceInfo.getHostAddresses();
            for (InetAddress address : hosts) {
                if (address instanceof Inet4Address) return address;
            }
            if (!hosts.isEmpty()) return hosts.get(0);
        }
        return serviceInfo.getHost();
    }

    private static String nsdAttribute(NsdServiceInfo serviceInfo, String key) {
        Map<String, byte[]> attributes = serviceInfo.getAttributes();
        byte[] data = attributes == null ? null : attributes.get(key);
        if (data == null || data.length == 0) return "";
        return new String(data, StandardCharsets.UTF_8).trim();
    }

    static String hostForUrl(String host) {
        if (host == null) return "";
        String value = host.trim();
        if (value.indexOf(':') >= 0 && !(value.startsWith("[") && value.endsWith("]"))) return "[" + value + "]";
        return value;
    }

    @SuppressWarnings("deprecation")
    private InetAddress wifiBroadcastAddress() {
        try {
            WifiManager wifiManager = (WifiManager) getContext().getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
            DhcpInfo dhcp = wifiManager == null ? null : wifiManager.getDhcpInfo();
            if (dhcp == null || dhcp.netmask == 0) return null;
            int broadcast = (dhcp.ipAddress & dhcp.netmask) | ~dhcp.netmask;
            byte[] quads = new byte[4];
            for (int index = 0; index < 4; index++) {
                quads[index] = (byte) ((broadcast >> (index * 8)) & 0xff);
            }
            return InetAddress.getByAddress(quads);
        } catch (Exception ignored) {
            return null;
        }
    }

    private String resolvedAlias(String requested) {
        String value = requested == null ? "" : requested.trim();
        String normalized = value.toLowerCase(java.util.Locale.ROOT)
            .replace(" ", "")
            .replace("-", "");
        boolean generic = normalized.isEmpty()
            || "carejournal".equals(normalized)
            || "carejournal手机".equals(normalized)
            || "carejournalandroid".equals(normalized);
        if (!generic) return value.length() > 48 ? value.substring(0, 48) : value;

        // Prefer the user-configured device name (Android 7.1+, API 25). This is
        // what appears in Settings → About phone → Device name, e.g. "小明的手机".
        // Falls through to Bluetooth's user name on devices that do not expose
        // Settings.Global.DEVICE_NAME, and finally to manufacturer + model.
        String userDeviceName = readDeviceName();
        if (!userDeviceName.isEmpty()) {
            return userDeviceName.length() > 48 ? userDeviceName.substring(0, 48) : userDeviceName;
        }

        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        String model = Build.MODEL == null ? "" : Build.MODEL.trim();
        String device = model;
        if (!manufacturer.isEmpty() && !model.toLowerCase(java.util.Locale.ROOT)
            .startsWith(manufacturer.toLowerCase(java.util.Locale.ROOT))) {
            device = manufacturer + " " + model;
        }
        device = device.trim();
        return device.isEmpty() ? "CareJournal Android" : device;
    }

    private String readDeviceName() {
        Context context = getContext();
        if (context == null) return "";
        ContentResolver resolver = context.getContentResolver();
        if (resolver == null) return "";
        String[] candidates;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
            candidates = new String[] { Settings.Global.DEVICE_NAME, "device_name", "bluetooth_name" };
        } else {
            // Pre-25: Settings.Global.DEVICE_NAME did not exist, but many OEMs
            // still populate the same key; try it defensively along with the
            // Bluetooth adapter name that reflects the user-configured label.
            candidates = new String[] { "device_name", "bluetooth_name" };
        }
        for (String key : candidates) {
            try {
                String value = Settings.Global.getString(resolver, key);
                if (value != null && !value.trim().isEmpty()) return value.trim();
            } catch (Throwable ignored) {
                // Any failure just falls through to the next candidate.
            }
            try {
                String value = Settings.Secure.getString(resolver, key);
                if (value != null && !value.trim().isEmpty()) return value.trim();
            } catch (Throwable ignored) {
                // Same as above.
            }
            try {
                String value = Settings.System.getString(resolver, key);
                if (value != null && !value.trim().isEmpty()) return value.trim();
            } catch (Throwable ignored) {
                // Same as above.
            }
        }
        return "";
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
        stopNsd();
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
        String reason = status == 200 ? "OK" : status == 202 ? "Accepted" : status == 204 ? "No Content" : status == 404 ? "Not Found" : status == 409 ? "Conflict" : status == 410 ? "Gone" : "Error";
        String headers = "HTTP/1.1 " + status + " " + reason + "\r\n"
            + "Content-Type: application/json; charset=utf-8\r\n"
            + "Content-Length: " + data.length + "\r\n"
            + "Cache-Control: no-store\r\n"
            + "Access-Control-Allow-Origin: *\r\n"
            + "Access-Control-Allow-Headers: Content-Type, X-CareJournal-Alias, X-CareJournal-Fingerprint\r\n"
            + "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n"
            + "Connection: close\r\n\r\n";
        output.write(headers.getBytes(StandardCharsets.UTF_8));
        output.write(data);
        output.flush();
    }

    private JSONObject requestJson(String method, String url, String body, int timeout) throws Exception {
        HttpResult result = rawRequest(method, url, body, timeout);
        JSONObject json = new JSONObject(result.body);
        if (result.status < 200 || result.status >= 300) throw new IOException(json.optString("error", "远程设备返回 " + result.status));
        return json;
    }

    private HttpResult rawRequest(String method, String url, String body, int timeout) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(timeout);
        connection.setReadTimeout(timeout);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("X-CareJournal-Alias", URLEncoder.encode(alias, StandardCharsets.UTF_8.name()));
        connection.setRequestProperty("X-CareJournal-Fingerprint", fingerprint);
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
            while ((count = stream.read(buffer)) >= 0) {
                if (output.size() + count > MAX_BODY_BYTES) throw new IOException("远程设备返回内容过大");
                output.write(buffer, 0, count);
            }
            stream.close();
        }
        connection.disconnect();
        return new HttpResult(status, output.toString(StandardCharsets.UTF_8.name()));
    }

    private static String headerValue(String[] headers, String name) {
        String prefix = name.toLowerCase(java.util.Locale.ROOT) + ":";
        for (String header : headers) {
            if (header.toLowerCase(java.util.Locale.ROOT).startsWith(prefix)) {
                return header.substring(header.indexOf(':') + 1).trim();
            }
        }
        return "";
    }

    private static String decodeHeader(String value) {
        try {
            return URLDecoder.decode(value, StandardCharsets.UTF_8.name());
        } catch (Exception ignored) {
            return value;
        }
    }

    private static String safeMessage(Exception error) {
        return error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
    }

    private void expirePending() {
        long cutoff = System.currentTimeMillis() - PENDING_TTL_MS;
        pending.entrySet().removeIf(entry -> entry.getValue().createdAt < cutoff);
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
        final long createdAt = System.currentTimeMillis();

        PendingRequest(String requestId, String envelope) {
            this.requestId = requestId;
            this.envelope = envelope;
        }
    }

    static class NsdPeerRecord {
        final String fingerprint;
        final String alias;
        final String deviceType;
        final String publicKey;
        final String host;
        final int port;

        NsdPeerRecord(String fingerprint, String alias, String deviceType, String publicKey, String host, int port) {
            this.fingerprint = fingerprint;
            this.alias = alias;
            this.deviceType = deviceType;
            this.publicKey = publicKey;
            this.host = host;
            this.port = port;
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
