import Capacitor
import Foundation
import Network
import UIKit

public class LanSyncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LanSyncPlugin"
    public let jsName = "LanSync"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "refresh", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listPeers", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendSync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "completeSync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rejectSync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTransferActive", returnType: CAPPluginReturnPromise),
    ]

    private static let serviceType = "_carejournal._tcp"
    private static let app = "carejournal"
    private static let version = "4"
    private static let port: UInt16 = 53318
    private static let peerTtlMs: Int64 = 90_000
    private static let pendingTtlMs: Int64 = 125_000
    private static let maxHeaderBytes = 32 * 1024
    private static let maxBodyBytes = 300 * 1024 * 1024
    private static let requestTimeout: TimeInterval = 30
    private static let pollTimeout: TimeInterval = 10
    private static let sendDeadline: TimeInterval = 120
    private static let aliasTargetBytes = 160
    private static let txtTargetBytes = 400

    private let queue = DispatchQueue(label: "com.carejournal.app.lanSync", qos: .utility)
    private var listener: NWListener?
    private var browser: NWBrowser?
    private var active = false
    private var alias = "CareJournal iPhone"
    private var publicKey = ""
    private var fingerprint = ""
    private var serviceName = ""
    private var peers: [String: Peer] = [:]
    private var pending: [String: PendingRequest] = [:]

    @objc func start(_ call: CAPPluginCall) {
        let requestedAlias = call.getString("alias") ?? ""
        let requestedPublicKey = call.getString("publicKey") ?? ""
        if requestedPublicKey.isEmpty {
            call.reject("无法开启局域网同步：设备加密密钥无效")
            return
        }

        queue.async {
            do {
                self.stopInternal()
                self.alias = self.resolvedAlias(requestedAlias)
                self.publicKey = requestedPublicKey
                self.fingerprint = self.loadFingerprint()
                self.serviceName = self.opaqueServiceName()
                self.active = true
                try self.startListener()
                self.startBrowser()
                call.resolve(self.serviceInfo())
            } catch {
                self.stopInternal()
                call.reject("无法开启局域网同步：\(self.safeMessage(error))", nil, error)
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        queue.async {
            self.stopInternal()
            call.resolve()
        }
    }

    @objc func refresh(_ call: CAPPluginCall) {
        queue.async {
            guard self.active else {
                call.reject("局域网同步尚未开启")
                return
            }
            if self.browser == nil { self.startBrowser() }
            self.expirePeers()
            self.expirePending()
            self.notifyPeers()
            call.resolve()
        }
    }

    @objc func listPeers(_ call: CAPPluginCall) {
        queue.async {
            self.expirePeers()
            call.resolve(["peers": self.peerArray()])
        }
    }

    @objc func sendSync(_ call: CAPPluginCall) {
        let host = call.getString("host") ?? ""
        let remotePort = call.getInt("port") ?? Int(Self.port)
        let envelope = call.getString("envelope") ?? ""
        queue.async {
            do {
                guard self.active else { throw LanSyncError.message("局域网同步尚未开启") }
                guard let peer = self.currentPeers().first(where: { $0.host == host && $0.port == remotePort }) else {
                    throw LanSyncError.message("目标设备不在当前发现列表中，请刷新后重试")
                }
                let endpoint = peer.endpoint ?? self.hostPortEndpoint(host: host, port: remotePort)
                let created = try self.requestJson(method: "POST", endpoint: endpoint, path: "/carejournal/v1/sync", body: envelope, timeout: Self.requestTimeout)
                guard let requestId = created["requestId"] as? String, !requestId.isEmpty else {
                    throw LanSyncError.message("目标设备未返回同步请求编号")
                }
                let deadline = Date().addingTimeInterval(Self.sendDeadline)
                while Date() < deadline {
                    Thread.sleep(forTimeInterval: 0.025)
                    let result = try self.rawRequest(method: "GET", endpoint: endpoint, path: "/carejournal/v1/result/\(requestId)", body: nil, timeout: Self.pollTimeout)
                    let body = self.parseJsonObject(result.body)
                    if result.status == 202 { continue }
                    if result.status < 200 || result.status >= 300 {
                        throw LanSyncError.message((body["error"] as? String) ?? "对方设备未能完成同步")
                    }
                    guard let responseEnvelope = body["envelope"] as? String else {
                        throw LanSyncError.message("对方设备返回内容无效")
                    }
                    call.resolve(["envelope": responseEnvelope])
                    return
                }
                throw LanSyncError.message("等待对方完成同步超时")
            } catch {
                call.reject("局域网同步失败：\(self.safeMessage(error))", nil, error)
            }
        }
    }

    @objc func completeSync(_ call: CAPPluginCall) {
        let requestId = call.getString("requestId") ?? ""
        let envelope = call.getString("envelope") ?? ""
        queue.async {
            self.expirePending()
            guard let request = self.pending[requestId] else {
                call.reject("同步请求已失效")
                return
            }
            request.resultEnvelope = envelope
            call.resolve()
        }
    }

    @objc func rejectSync(_ call: CAPPluginCall) {
        let requestId = call.getString("requestId") ?? ""
        let error = call.getString("error") ?? "接收方拒绝了同步"
        queue.async {
            self.expirePending()
            guard let request = self.pending[requestId] else {
                call.reject("同步请求已失效")
                return
            }
            request.error = error.isEmpty ? "接收方拒绝了同步" : error
            call.resolve()
        }
    }

    @objc func setTransferActive(_ call: CAPPluginCall) {
        // Foreground-only on iOS: no background modes, no long-running service.
        call.resolve()
    }

    private func startListener() throws {
        let port = NWEndpoint.Port(rawValue: Self.port)!
        let listener = try NWListener(using: .tcp, on: port)
        listener.service = NWListener.Service(
            name: serviceName,
            type: Self.serviceType,
            domain: nil,
            txtRecord: bonjourTxtRecord()
        )
        listener.newConnectionHandler = { [weak self] connection in
            self?.queue.async { self?.handleConnection(connection) }
        }
        listener.stateUpdateHandler = { [weak self] state in
            guard case .failed = state else { return }
            self?.queue.async { self?.stopInternal() }
        }
        self.listener = listener
        listener.start(queue: queue)
    }

    private func startBrowser() {
        browser?.cancel()
        let parameters = NWParameters.tcp
        parameters.includePeerToPeer = true
        let browser = NWBrowser(for: .bonjour(type: Self.serviceType, domain: nil), using: parameters)
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            self?.queue.async { self?.handleBrowseResults(results) }
        }
        browser.stateUpdateHandler = { [weak self] state in
            if case .failed = state {
                self?.queue.async { self?.browser = nil }
            }
        }
        self.browser = browser
        browser.start(queue: queue)
    }

    private func handleBrowseResults(_ results: Set<NWBrowser.Result>) {
        guard active else { return }
        var changed = false
        for result in results {
            guard let record = parseBonjourRecord(result) else { continue }
            let host = serviceName(from: result.endpoint) ?? record.fingerprint
            peers[record.fingerprint] = Peer(
                fingerprint: record.fingerprint,
                alias: record.alias,
                deviceType: record.deviceType,
                publicKey: record.publicKey,
                host: host,
                port: Int(Self.port),
                lastSeen: nowMs(),
                endpoint: result.endpoint
            )
            changed = true
        }
        expirePeers()
        if changed { notifyPeers() }
    }

    private func parseBonjourRecord(_ result: NWBrowser.Result) -> BonjourRecord? {
        guard case .bonjour(let txtRecord) = result.metadata else { return nil }
        let app = txtRecord["app"] ?? ""
        let version = txtRecord["v"] ?? ""
        let remoteFingerprint = txtRecord["fp"] ?? ""
        let remotePublicKey = txtRecord["pk"] ?? ""
        let deviceType = txtRecord["dt"] ?? ""
        let remoteAlias = txtRecord["alias"] ?? ""
        guard app == Self.app, version == Self.version else { return nil }
        guard !remoteFingerprint.isEmpty, !remotePublicKey.isEmpty, !remoteAlias.isEmpty, !deviceType.isEmpty else { return nil }
        guard remoteFingerprint != fingerprint else { return nil }
        return BonjourRecord(
            fingerprint: remoteFingerprint,
            alias: remoteAlias,
            deviceType: deviceType == "web" ? "web" : "mobile",
            publicKey: remotePublicKey
        )
    }

    private func handleConnection(_ connection: NWConnection) {
        guard active else {
            connection.cancel()
            return
        }
        let state = ConnectionState(connection: connection)
        let timeout = DispatchWorkItem { [weak self] in
            self?.respond(state.connection, status: 400, body: ["error": "请求内容无效"])
        }
        state.timeout = timeout
        queue.asyncAfter(deadline: .now() + Self.requestTimeout, execute: timeout)
        connection.stateUpdateHandler = { newState in
            if case .failed = newState { connection.cancel() }
        }
        connection.start(queue: queue)
        receive(state)
    }

    private func receive(_ state: ConnectionState) {
        state.connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self, state] data, _, isComplete, error in
            guard let self else { return }
            if let data { state.buffer.append(data) }
            if let error {
                state.timeout?.cancel()
                state.connection.cancel()
                _ = error
                return
            }
            do {
                if state.buffer.count > Self.maxHeaderBytes + Self.maxBodyBytes {
                    state.timeout?.cancel()
                    self.respond(state.connection, status: 413, body: ["error": "同步数据过大"])
                    return
                }
                if let request = try self.parseRequest(state.buffer) {
                    state.timeout?.cancel()
                    self.handleRequest(state.connection, request: request, peerAddress: self.remoteAddress(state.connection.endpoint))
                    return
                }
                if isComplete {
                    state.timeout?.cancel()
                    self.respond(state.connection, status: 400, body: ["error": "请求内容无效"])
                    return
                }
                self.receive(state)
            } catch LanSyncError.payloadTooLarge {
                state.timeout?.cancel()
                self.respond(state.connection, status: 413, body: ["error": "同步数据过大"])
            } catch {
                state.timeout?.cancel()
                self.respond(state.connection, status: 400, body: ["error": "请求内容无效"])
            }
        }
    }

    private func handleRequest(_ connection: NWConnection, request: HttpRequest, peerAddress: String) {
        if request.method == "OPTIONS" {
            respond(connection, status: 204, body: [:])
            return
        }
        if request.method == "POST", request.path == "/carejournal/v1/sync" {
            do {
                let envelope = try parseJsonObject(request.body)
                let remotePublicKey = envelope["senderPublicKey"] as? String ?? ""
                var remoteFingerprint = request.headers["x-carejournal-fingerprint"] ?? ""
                let encodedAlias = request.headers["x-carejournal-alias"] ?? ""
                let remoteAlias = decodeHeader(encodedAlias).isEmpty ? "CareJournal 设备" : decodeHeader(encodedAlias)
                if !remotePublicKey.isEmpty {
                    if remoteFingerprint.isEmpty {
                        remoteFingerprint = String(remotePublicKey.prefix(32))
                    }
                    if !remoteFingerprint.isEmpty, remoteFingerprint != fingerprint {
                        peers[remoteFingerprint] = Peer(
                            fingerprint: remoteFingerprint,
                            alias: remoteAlias,
                            deviceType: "mobile",
                            publicKey: remotePublicKey,
                            host: peerAddress,
                            port: Int(Self.port),
                            lastSeen: nowMs(),
                            endpoint: hostPortEndpoint(host: peerAddress, port: Int(Self.port))
                        )
                        notifyPeers()
                    }
                }
                let requestId = UUID().uuidString
                pending[requestId] = PendingRequest(envelope: request.body)
                notifyListeners("syncRequest", data: [
                    "requestId": requestId,
                    "envelope": request.body,
                    "peerAddress": peerAddress,
                ])
                respond(connection, status: 202, body: ["requestId": requestId])
            } catch {
                respond(connection, status: 400, body: ["error": "请求内容无效"])
            }
            return
        }
        if request.method == "GET", request.path.hasPrefix("/carejournal/v1/result/") {
            expirePending()
            let requestId = String(request.path.dropFirst("/carejournal/v1/result/".count))
            guard let request = pending[requestId] else {
                respond(connection, status: 410, body: ["error": "同步请求已失效"])
                return
            }
            if let error = request.error {
                pending.removeValue(forKey: requestId)
                respond(connection, status: 409, body: ["error": error])
            } else if let envelope = request.resultEnvelope {
                pending.removeValue(forKey: requestId)
                respond(connection, status: 200, body: ["envelope": envelope])
            } else {
                respond(connection, status: 202, body: ["status": "pending"])
            }
            return
        }
        respond(connection, status: 404, body: ["error": "Not found"])
    }

    private func parseRequest(_ raw: Data) throws -> HttpRequest? {
        guard let separator = raw.range(of: Data([13, 10, 13, 10])) else {
            if raw.count > Self.maxHeaderBytes { throw LanSyncError.message("HTTP 请求头过大") }
            return nil
        }
        if separator.lowerBound > Self.maxHeaderBytes { throw LanSyncError.message("HTTP 请求头过大") }
        guard let headerText = String(data: Data(raw[..<separator.lowerBound]), encoding: .utf8) else {
            throw LanSyncError.message("HTTP 请求头无效")
        }
        let lines = headerText.components(separatedBy: "\r\n")
        let requestLine = lines.first?.split(separator: " ").map(String.init) ?? []
        guard requestLine.count >= 2 else { throw LanSyncError.message("HTTP 请求行无效") }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[..<colon].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespacesAndNewlines)
            headers[name] = value
        }
        let contentLength = Int(headers["content-length"] ?? "0") ?? -1
        if contentLength < 0 { throw LanSyncError.message("HTTP 请求内容长度无效") }
        if contentLength > Self.maxBodyBytes { throw LanSyncError.payloadTooLarge }
        let bodyOffset = separator.upperBound
        guard raw.count >= bodyOffset + contentLength else { return nil }
        guard let body = String(data: Data(raw[bodyOffset..<(bodyOffset + contentLength)]), encoding: .utf8) else {
            throw LanSyncError.message("HTTP 请求内容无效")
        }
        return HttpRequest(method: requestLine[0], path: requestLine[1], headers: headers, body: body)
    }

    private func respond(_ connection: NWConnection, status: Int, body: [String: Any]) {
        let responseBody = status == 204 ? Data() : jsonData(body)
        let reason = status == 200 ? "OK" : status == 202 ? "Accepted" : status == 204 ? "No Content" : status == 404 ? "Not Found" : status == 409 ? "Conflict" : status == 410 ? "Gone" : "Error"
        let header = "HTTP/1.1 \(status) \(reason)\r\n"
            + "Content-Type: application/json; charset=utf-8\r\n"
            + "Content-Length: \(responseBody.count)\r\n"
            + "Cache-Control: no-store\r\n"
            + "Access-Control-Allow-Origin: *\r\n"
            + "Access-Control-Allow-Headers: Content-Type, X-CareJournal-Alias, X-CareJournal-Fingerprint\r\n"
            + "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n"
            + "Connection: close\r\n\r\n"
        var data = Data(header.utf8)
        data.append(responseBody)
        connection.send(content: data, completion: .contentProcessed { _ in connection.cancel() })
    }

    private func requestJson(method: String, endpoint: NWEndpoint, path: String, body: String?, timeout: TimeInterval) throws -> [String: Any] {
        let result = try rawRequest(method: method, endpoint: endpoint, path: path, body: body, timeout: timeout)
        let json = try parseJsonObject(result.body)
        if result.status < 200 || result.status >= 300 {
            throw LanSyncError.message((json["error"] as? String) ?? "远程设备返回 \(result.status)")
        }
        return json
    }

    private func rawRequest(method: String, endpoint: NWEndpoint, path: String, body: String?, timeout: TimeInterval) throws -> HttpResult {
        let connection = NWConnection(to: endpoint, using: .tcp)
        let semaphore = DispatchSemaphore(value: 0)
        let lock = NSLock()
        var completed = false
        var response = Data()
        var result: Result<HttpResult, Error>?

        func finish(_ value: Result<HttpResult, Error>) {
            lock.lock()
            defer { lock.unlock() }
            guard !completed else { return }
            completed = true
            result = value
            connection.cancel()
            semaphore.signal()
        }

        func receive() {
            connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { data, _, isComplete, error in
                if let data { response.append(data) }
                if response.count > Self.maxHeaderBytes + Self.maxBodyBytes {
                    finish(.failure(LanSyncError.payloadTooLarge))
                    return
                }
                if let error {
                    finish(.failure(error))
                    return
                }
                if isComplete {
                    do { finish(.success(try self.parseHttpResponse(response))) }
                    catch { finish(.failure(error)) }
                    return
                }
                receive()
            }
        }

        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                let request = self.httpRequestData(method: method, endpoint: endpoint, path: path, body: body)
                connection.send(content: request, completion: .contentProcessed { error in
                    if let error { finish(.failure(error)) }
                    else { receive() }
                })
            case .failed(let error):
                finish(.failure(error))
            default:
                break
            }
        }
        connection.start(queue: DispatchQueue.global(qos: .utility))
        if semaphore.wait(timeout: .now() + timeout) == .timedOut {
            finish(.failure(LanSyncError.message("请求超时")))
        }
        guard let result else { throw LanSyncError.message("请求失败") }
        return try result.get()
    }

    private func httpRequestData(method: String, endpoint: NWEndpoint, path: String, body: String?) -> Data {
        let bodyData = body.map { Data($0.utf8) } ?? Data()
        var request = "\(method) \(path) HTTP/1.1\r\n"
        request += "Host: \(hostHeader(endpoint))\r\n"
        request += "Content-Type: application/json\r\n"
        request += "X-CareJournal-Alias: \(encodeHeader(alias))\r\n"
        request += "X-CareJournal-Fingerprint: \(fingerprint)\r\n"
        request += "Content-Length: \(bodyData.count)\r\n"
        request += "Connection: close\r\n\r\n"
        var data = Data(request.utf8)
        data.append(bodyData)
        return data
    }

    private func parseHttpResponse(_ data: Data) throws -> HttpResult {
        guard let separator = data.range(of: Data([13, 10, 13, 10])),
              let headerText = String(data: Data(data[..<separator.lowerBound]), encoding: .utf8) else {
            throw LanSyncError.message("远程设备返回无效")
        }
        let headerLines = headerText.components(separatedBy: "\r\n")
        let statusLine = headerLines.first ?? ""
        let parts = statusLine.split(separator: " ")
        guard parts.count >= 2, let status = Int(parts[1]) else {
            throw LanSyncError.message("远程设备返回无效")
        }
        var headers: [String: String] = [:]
        for line in headerLines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            headers[String(line[..<colon]).lowercased()] = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
        }
        guard let length = Int(headers["content-length"] ?? ""), length >= 0 else {
            throw LanSyncError.message("远程设备返回长度无效")
        }
        guard length <= Self.maxBodyBytes else { throw LanSyncError.payloadTooLarge }
        let available = data.count - separator.upperBound
        guard available == length else { throw LanSyncError.message("远程设备返回内容不完整") }
        let bodyData = data[separator.upperBound..<(separator.upperBound + length)]
        guard let body = String(data: Data(bodyData), encoding: .utf8) else {
            throw LanSyncError.message("远程设备返回内容无效")
        }
        return HttpResult(status: status, body: body)
    }

    private func bonjourTxtRecord() -> NWTXTRecord {
        let fixed: [String: String] = [
            "app": Self.app,
            "v": Self.version,
            "fp": fingerprint,
            "pk": publicKey,
            "dt": "mobile",
        ]
        let fixedBytes = fixed.reduce(0) { $0 + txtEntryBytes(key: $1.key, value: $1.value) }
        let remaining = Self.txtTargetBytes - fixedBytes - Data("alias=".utf8).count
        let aliasBudget = max(0, min(Self.aliasTargetBytes, remaining))
        var values = fixed
        values["alias"] = truncateUtf8(alias, maxBytes: aliasBudget)
        return NWTXTRecord(values)
    }

    private func stopInternal() {
        active = false
        listener?.cancel()
        browser?.cancel()
        listener = nil
        browser = nil
        peers.removeAll()
        pending.removeAll()
    }

    private func notifyPeers() {
        notifyListeners("peersChanged", data: ["peers": peerArray()])
    }

    private func currentPeers() -> [Peer] {
        expirePeers()
        return peers.values.sorted { $0.lastSeen > $1.lastSeen }
    }

    private func peerArray() -> [[String: Any]] {
        currentPeers().map { peer in
            [
                "fingerprint": peer.fingerprint,
                "alias": peer.alias,
                "deviceType": peer.deviceType,
                "publicKey": peer.publicKey,
                "host": peer.host,
                "port": peer.port,
                "lastSeen": peer.lastSeen,
            ]
        }
    }

    private func expirePeers() {
        let cutoff = nowMs() - Self.peerTtlMs
        peers = peers.filter { $0.value.lastSeen >= cutoff }
    }

    private func expirePending() {
        let cutoff = nowMs() - Self.pendingTtlMs
        pending = pending.filter { $0.value.createdAt >= cutoff }
    }

    private func serviceInfo() -> [String: Any] {
        [
            "alias": alias,
            "fingerprint": fingerprint,
            "publicKey": publicKey,
            "port": Int(Self.port),
            "transport": "native",
        ]
    }

    private func loadFingerprint() -> String {
        let key = "carejournal_lan_fingerprint"
        if let existing = UserDefaults.standard.string(forKey: key), !existing.isEmpty { return existing }
        let created = UUID().uuidString
        UserDefaults.standard.set(created, forKey: key)
        return created
    }

    private func opaqueServiceName() -> String {
        "cj-ios-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12)
    }

    private func resolvedAlias(_ requested: String) -> String {
        let trimmed = requested.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return String(trimmed.prefix(48)) }
        return "CareJournal iPhone"
    }

    private func hostPortEndpoint(host: String, port: Int) -> NWEndpoint {
        NWEndpoint.hostPort(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: UInt16(port)) ?? NWEndpoint.Port(rawValue: Self.port)!)
    }

    private func hostHeader(_ endpoint: NWEndpoint) -> String {
        switch endpoint {
        case .hostPort(let host, let port):
            return "\(hostForUrl(String(describing: host))):\(port.rawValue)"
        case .service(let name, _, _, _):
            return name
        default:
            return "carejournal"
        }
    }

    private func hostForUrl(_ host: String) -> String {
        let value = host.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.contains(":") && !(value.hasPrefix("[") && value.hasSuffix("]")) { return "[\(value)]" }
        return value
    }

    private func serviceName(from endpoint: NWEndpoint) -> String? {
        if case .service(let name, _, _, _) = endpoint { return name }
        return nil
    }

    private func remoteAddress(_ endpoint: NWEndpoint) -> String {
        if case .hostPort(let host, _) = endpoint { return String(describing: host) }
        return ""
    }

    private func parseJsonObject(_ text: String) throws -> [String: Any] {
        let data = Data(text.utf8)
        let value = try JSONSerialization.jsonObject(with: data)
        guard let object = value as? [String: Any] else { throw LanSyncError.message("JSON 内容无效") }
        return object
    }

    private func jsonData(_ object: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: object, options: [])) ?? Data("{}".utf8)
    }

    private func encodeHeader(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
    }

    private func decodeHeader(_ value: String) -> String {
        value.removingPercentEncoding ?? value
    }

    private func truncateUtf8(_ value: String, maxBytes: Int) -> String {
        guard maxBytes > 0 else { return "" }
        var result = ""
        var used = 0
        for character in value {
            let count = Data(String(character).utf8).count
            if used + count > maxBytes { break }
            result.append(character)
            used += count
        }
        return result
    }

    private func txtEntryBytes(key: String, value: String) -> Int {
        Data("\(key)=\(value)".utf8).count
    }

    private func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    private func safeMessage(_ error: Error) -> String {
        if case LanSyncError.message(let message) = error { return message }
        return error.localizedDescription
    }

    deinit {
        stopInternal()
    }
}

private final class Peer {
    let fingerprint: String
    let alias: String
    let deviceType: String
    let publicKey: String
    let host: String
    let port: Int
    let lastSeen: Int64
    let endpoint: NWEndpoint?

    init(fingerprint: String, alias: String, deviceType: String, publicKey: String, host: String, port: Int, lastSeen: Int64, endpoint: NWEndpoint?) {
        self.fingerprint = fingerprint
        self.alias = alias
        self.deviceType = deviceType
        self.publicKey = publicKey
        self.host = host
        self.port = port
        self.lastSeen = lastSeen
        self.endpoint = endpoint
    }
}

private final class PendingRequest {
    let envelope: String
    let createdAt: Int64
    var resultEnvelope: String?
    var error: String?

    init(envelope: String) {
        self.envelope = envelope
        self.createdAt = Int64(Date().timeIntervalSince1970 * 1000)
    }
}

private final class ConnectionState {
    let connection: NWConnection
    var buffer = Data()
    var timeout: DispatchWorkItem?

    init(connection: NWConnection) {
        self.connection = connection
    }
}

private struct BonjourRecord {
    let fingerprint: String
    let alias: String
    let deviceType: String
    let publicKey: String
}

private struct HttpRequest {
    let method: String
    let path: String
    let headers: [String: String]
    let body: String
}

private struct HttpResult {
    let status: Int
    let body: String
}

private enum LanSyncError: Error {
    case message(String)
    case payloadTooLarge
}
