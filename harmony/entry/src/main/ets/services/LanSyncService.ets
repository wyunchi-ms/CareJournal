import { common } from '@kit.AbilityKit';
import { connection, http, socket } from '@kit.NetworkKit';
import { preferences } from '@kit.ArkData';
import { util } from '@kit.ArkTS';
import runningLock from '@ohos.runningLock';

const PORT: number = 53318;
const MULTICAST_ADDRESS: string = '224.0.0.167';
const BROADCAST_ADDRESS: string = '255.255.255.255';
const PEER_TTL_MS: number = 90000;
const PENDING_TTL_MS: number = 5 * 60 * 1000;
const MAX_HEADER_BYTES: number = 32 * 1024;
const MAX_BODY_BYTES: number = 300 * 1024 * 1024;
const CLIENT_REQUEST_TIMEOUT_MS: number = 30000;

interface PeerAdvertisement {
  app: string;
  version: number;
  alias: string;
  deviceType: string;
  fingerprint: string;
  publicKey: string;
  port: number;
  announce: boolean;
}

interface LanPeer {
  fingerprint: string;
  alias: string;
  deviceType: string;
  publicKey: string;
  host: string;
  port: number;
  lastSeen: number;
}

class PendingRequest {
  resultEnvelope: string = '';
  error: string = '';
  createdAt: number = Date.now();
}

interface HttpRequest {
  method: string;
  path: string;
  headers: Map<string, string>;
  body: string;
}

interface RawHttpResult {
  status: number;
  body: string;
}

class PeersChangedEvent {
  type: string = 'peersChanged';
  peers: LanPeer[];

  constructor(peers: LanPeer[]) {
    this.peers = peers;
  }
}

class SyncRequestEvent {
  type: string = 'syncRequest';
  requestId: string;
  envelope: string;
  peerAddress: string;

  constructor(requestId: string, envelope: string, peerAddress: string) {
    this.requestId = requestId;
    this.envelope = envelope;
    this.peerAddress = peerAddress;
  }
}

export class LanSyncService {
  private context: common.UIAbilityContext;
  private emit: (detail: object) => void;
  private udp?: socket.MulticastSocket;
  private server?: socket.TCPSocketServer;
  private peers: Map<string, LanPeer> = new Map();
  private pending: Map<string, PendingRequest> = new Map();
  private clientBuffers: Map<socket.TCPSocketConnection, Uint8Array> = new Map();
  private clientTimers: Map<socket.TCPSocketConnection, number> = new Map();
  private alias: string = 'CareJournal 鸿蒙设备';
  private publicKey: string = '';
  private fingerprint: string = '';
  private active: boolean = false;
  private announceTimer: number = -1;
  private transferLock?: runningLock.RunningLock;
  private transferLockPromise?: Promise<void>;

  constructor(
    context: common.UIAbilityContext,
    emit: (detail: object) => void
  ) {
    this.context = context;
    this.emit = emit;
  }

  async start(alias: string, publicKey: string): Promise<string> {
    if (!publicKey) throw new Error('设备加密密钥无效');
    await this.stop();
    this.alias = alias.trim() || 'CareJournal 鸿蒙设备';
    this.publicKey = publicKey;
    const store = await preferences.getPreferences(this.context, 'carejournal_lan');
    this.fingerprint = String(await store.get('fingerprint', ''));
    if (!this.fingerprint) {
      this.fingerprint = util.generateRandomUUID(true);
      await store.put('fingerprint', this.fingerprint);
      await store.flush();
    }
    this.active = true;
    try {
      await this.startServer();
      await this.startDiscovery();
      this.announceTimer = setInterval(() => {
        this.announce(false).catch(() => undefined);
        this.expirePending();
      }, 5000);
      await this.announce(true);
    } catch (error) {
      await this.stop();
      throw new Error(error instanceof Error ? error.message : '无法开启局域网同步');
    }
    return JSON.stringify({
      alias: this.alias,
      fingerprint: this.fingerprint,
      publicKey: this.publicKey,
      port: PORT,
      transport: 'native'
    });
  }

  async stop(): Promise<void> {
    this.active = false;
    await this.setTransferActive(false).catch(() => undefined);
    if (this.announceTimer >= 0) clearInterval(this.announceTimer);
    this.announceTimer = -1;
    if (this.udp) {
      await this.udp.dropMembership({ address: MULTICAST_ADDRESS, port: PORT }).catch(() => undefined);
      await this.udp.close().catch(() => undefined);
    }
    if (this.server) await this.server.close().catch(() => undefined);
    this.udp = undefined;
    this.server = undefined;
    this.peers.clear();
    this.pending.clear();
    this.clientBuffers.clear();
    this.clientTimers.forEach((timer) => clearTimeout(timer));
    this.clientTimers.clear();
  }

  async refresh(): Promise<void> {
    if (!this.active) throw new Error('局域网同步尚未开启');
    await this.announce(true);
    this.emitPeers();
  }

  listPeers(): string {
    this.expirePeers();
    return JSON.stringify({ peers: this.sortedPeers() });
  }

  async setTransferActive(active: boolean): Promise<void> {
    if (active) {
      if (this.transferLock) return;
      if (this.transferLockPromise) return this.transferLockPromise;
      const operation = this.acquireTransferLock();
      this.transferLockPromise = operation;
      try {
        await operation;
      } finally {
        this.transferLockPromise = undefined;
      }
      return;
    }
    if (this.transferLockPromise) {
      await this.transferLockPromise.catch(() => undefined);
      this.transferLockPromise = undefined;
    }
    if (this.transferLock) {
      try {
        this.transferLock.unlock();
      } finally {
        this.transferLock = undefined;
      }
    }
  }

  private async acquireTransferLock(): Promise<void> {
    const supported = await runningLock.isRunningLockTypeSupported(runningLock.RunningLockType.BACKGROUND);
    if (!supported || this.transferLock) return;
    const lock = await runningLock.create('CareJournal:LanSync', runningLock.RunningLockType.BACKGROUND);
    lock.lock(30 * 60 * 1000);
    this.transferLock = lock;
  }

  async sendSync(host: string, port: number, envelope: string): Promise<string> {
    const known = this.sortedPeers().some((peer) => peer.host === host && peer.port === port);
    if (!known) throw new Error('目标设备不在当前发现列表中，请刷新后重试');
    const base = `http://${host}:${port}`;
    const created = await this.requestJson(http.RequestMethod.POST, `${base}/carejournal/v1/sync`, envelope, 30000);
    const requestId = String(created['requestId'] ?? '');
    if (!requestId) throw new Error('目标设备未返回同步请求编号');
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      const result = await this.rawRequest(http.RequestMethod.GET, `${base}/carejournal/v1/result/${requestId}`, '', 10000);
      const body = JSON.parse(result.body) as Record<string, Object>;
      if (result.status === 202) continue;
      if (result.status < 200 || result.status >= 300) {
        throw new Error(String(body['error'] ?? '对方设备未能完成同步'));
      }
      return String(body['envelope'] ?? '');
    }
    throw new Error('等待对方完成同步超时');
  }

  complete(requestId: string, envelope: string): void {
    const request = this.pending.get(requestId);
    if (!request) throw new Error('同步请求已失效');
    request.resultEnvelope = envelope;
  }

  reject(requestId: string, error: string): void {
    const request = this.pending.get(requestId);
    if (!request) throw new Error('同步请求已失效');
    request.error = error || '接收方拒绝了同步';
  }

  private async startDiscovery(): Promise<void> {
    const udp = socket.constructMulticastSocketInstance();
    this.udp = udp;
    udp.on('message', (event: socket.SocketMessageInfo) => {
      if (!this.active) return;
      try {
        const text = new util.TextDecoder().decodeToString(new Uint8Array(event.message));
        const advertisement = JSON.parse(text) as PeerAdvertisement;
        if (advertisement.app !== 'carejournal' || advertisement.version !== 4) return;
        if (!advertisement.fingerprint || !advertisement.publicKey ||
          advertisement.fingerprint === this.fingerprint) return;
        this.upsertPeer(
          advertisement.fingerprint,
          advertisement.alias,
          advertisement.deviceType,
          advertisement.publicKey,
          event.remoteInfo.address,
          advertisement.port || PORT
        );
        if (advertisement.announce) {
          this.announceTo(event.remoteInfo.address).catch(() => undefined);
          this.announce(false).catch(() => undefined);
        }
      } catch (_) {
        // Ignore unrelated multicast/broadcast traffic.
      }
    });
    await udp.bind({ address: '0.0.0.0', port: PORT });
    await udp.setExtraOptions({
      reuseAddress: true,
      broadcast: true,
      receiveBufferSize: 4 * 1024 * 1024,
      sendBufferSize: 4 * 1024 * 1024
    });
    await udp.addMembership({ address: MULTICAST_ADDRESS, port: PORT }).catch(() => undefined);
    await udp.setMulticastTTL(1).catch(() => undefined);
    await udp.setLoopbackMode(false).catch(() => undefined);
  }

  private advertisement(requestResponse: boolean): PeerAdvertisement {
    return {
      app: 'carejournal',
      version: 4,
      alias: this.alias,
      deviceType: 'mobile',
      fingerprint: this.fingerprint,
      publicKey: this.publicKey,
      port: PORT,
      announce: requestResponse
    };
  }

  private async announce(requestResponse: boolean): Promise<void> {
    if (!this.active || !this.udp) return;
    const payload = JSON.stringify(this.advertisement(requestResponse));
    const destinations: string[] = [MULTICAST_ADDRESS, BROADCAST_ADDRESS];
    const directed = await this.directedBroadcastAddress();
    if (directed && !destinations.includes(directed)) destinations.push(directed);
    for (const address of destinations) {
      await this.udp.send({
        data: payload,
        address: { address, port: PORT }
      }).catch(() => undefined);
    }
  }

  private async announceTo(address: string): Promise<void> {
    if (!this.active || !this.udp || !address) return;
    await this.udp.send({
      data: JSON.stringify(this.advertisement(false)),
      address: { address, port: PORT }
    });
  }

  private async directedBroadcastAddress(): Promise<string> {
    try {
      const handle = await connection.getDefaultNet();
      const properties = await connection.getConnectionProperties(handle);
      for (const link of properties.linkAddresses) {
        const address = link.address.address;
        if (!address || address.includes(':') || address.startsWith('127.')) continue;
        const parts = address.split('.').map((part) => Number(part));
        if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) continue;
        const prefix = Math.max(0, Math.min(32, link.prefixLength));
        const value = (((parts[0] << 24) >>> 0) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
        const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
        const broadcast = (value | (~mask >>> 0)) >>> 0;
        return [
          (broadcast >>> 24) & 0xFF,
          (broadcast >>> 16) & 0xFF,
          (broadcast >>> 8) & 0xFF,
          broadcast & 0xFF
        ].join('.');
      }
    } catch (_) {
      // Global broadcast and multicast remain available.
    }
    return '';
  }

  private async startServer(): Promise<void> {
    const server = socket.constructTCPSocketServerInstance();
    this.server = server;
    server.on('connect', (client: socket.TCPSocketConnection) => {
      this.clientBuffers.set(client, new Uint8Array(0));
      const timer = setTimeout(() => {
        this.clientBuffers.delete(client);
        this.clientTimers.delete(client);
        client.close().catch(() => undefined);
      }, CLIENT_REQUEST_TIMEOUT_MS);
      this.clientTimers.set(client, timer);
      client.on('message', (event: socket.SocketMessageInfo) => {
        this.handleClientMessage(client, new Uint8Array(event.message)).catch(async () => {
          this.clearClient(client);
          await this.respond(client, 400, JSON.stringify({ error: '请求内容无效' })).catch(() => undefined);
        });
      });
      client.on('close', () => this.clearClient(client));
    });
    await server.listen({ address: '0.0.0.0', port: PORT });
  }

  private async handleClientMessage(client: socket.TCPSocketConnection, chunk: Uint8Array): Promise<void> {
    const current = this.clientBuffers.get(client) ?? new Uint8Array(0);
    if (current.byteLength + chunk.byteLength > MAX_HEADER_BYTES + MAX_BODY_BYTES) {
      throw new Error('同步数据过大');
    }
    const combined = new Uint8Array(current.byteLength + chunk.byteLength);
    combined.set(current, 0);
    combined.set(chunk, current.byteLength);
    this.clientBuffers.set(client, combined);
    const request = this.parseRequest(combined);
    if (!request) return;
    this.clearClient(client);
    let remote: socket.NetAddress = { address: '', port: 0 };
    try {
      remote = await client.getRemoteAddress();
    } catch (_) {
      // Continue with an unknown address; discovery can still populate peers.
    }
    await this.handleRequest(client, request, remote.address);
  }

  private clearClient(client: socket.TCPSocketConnection): void {
    this.clientBuffers.delete(client);
    const timer = this.clientTimers.get(client);
    if (timer !== undefined) clearTimeout(timer);
    this.clientTimers.delete(client);
  }

  private parseRequest(raw: Uint8Array): HttpRequest | undefined {
    const separator = this.headerSeparator(raw);
    if (separator < 0) {
      if (raw.byteLength > MAX_HEADER_BYTES) throw new Error('HTTP 请求头过大');
      return undefined;
    }
    if (separator + 4 > MAX_HEADER_BYTES) throw new Error('HTTP 请求头过大');
    const headerText = new util.TextDecoder().decodeToString(raw.slice(0, separator));
    const lines = headerText.split('\r\n');
    const requestLine = lines[0].split(' ');
    if (requestLine.length < 2) throw new Error('HTTP 请求行无效');
    const headers = new Map<string, string>();
    for (const line of lines.slice(1)) {
      const colon = line.indexOf(':');
      if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }
    const length = Number(headers.get('content-length') ?? '0');
    if (!Number.isFinite(length) || length < 0 || length > MAX_BODY_BYTES) throw new Error('HTTP 请求内容长度无效');
    const bodyOffset = separator + 4;
    if (raw.byteLength < bodyOffset + length) return undefined;
    const body = new util.TextDecoder().decodeToString(raw.slice(bodyOffset, bodyOffset + length));
    return { method: requestLine[0], path: requestLine[1], headers, body };
  }

  private headerSeparator(raw: Uint8Array): number {
    for (let index = 0; index <= raw.byteLength - 4; index += 1) {
      if (raw[index] === 13 && raw[index + 1] === 10 && raw[index + 2] === 13 && raw[index + 3] === 10) {
        return index;
      }
    }
    return -1;
  }

  private async handleRequest(client: socket.TCPSocketConnection, request: HttpRequest, peerAddress: string): Promise<void> {
    try {
      if (request.method === 'OPTIONS') {
        await this.respond(client, 204, '');
        return;
      }
      if (request.method === 'POST' && request.path === '/carejournal/v1/sync') {
        const envelope = JSON.parse(request.body) as Record<string, Object>;
        const remotePublicKey = String(envelope['senderPublicKey'] ?? '');
        const remoteFingerprint = request.headers.get('x-carejournal-fingerprint') ??
          remotePublicKey.slice(0, Math.min(32, remotePublicKey.length));
        const encodedAlias = request.headers.get('x-carejournal-alias') ?? '';
        let remoteAlias = 'CareJournal 设备';
        try {
          remoteAlias = encodedAlias ? decodeURIComponent(encodedAlias) : remoteAlias;
        } catch (_) {
          // Keep the generic fallback.
        }
        if (remotePublicKey && remoteFingerprint && peerAddress) {
          this.upsertPeer(remoteFingerprint, remoteAlias, 'mobile', remotePublicKey, peerAddress, PORT);
        }
        const requestId = util.generateRandomUUID(true);
        this.pending.set(requestId, new PendingRequest());
        this.emit(new SyncRequestEvent(requestId, request.body, peerAddress));
        await this.respond(client, 202, JSON.stringify({ requestId }));
        return;
      }
      if (request.method === 'GET' && request.path.startsWith('/carejournal/v1/result/')) {
        const requestId = request.path.slice('/carejournal/v1/result/'.length);
        const pending = this.pending.get(requestId);
        if (!pending || (!pending.resultEnvelope && !pending.error)) {
          await this.respond(client, 202, JSON.stringify({ status: 'pending' }));
        } else if (pending.error) {
          this.pending.delete(requestId);
          await this.respond(client, 409, JSON.stringify({ error: pending.error }));
        } else {
          this.pending.delete(requestId);
          await this.respond(client, 200, JSON.stringify({ envelope: pending.resultEnvelope }));
        }
        return;
      }
      await this.respond(client, 404, JSON.stringify({ error: 'Not found' }));
    } catch (_) {
      await this.respond(client, 400, JSON.stringify({ error: '请求内容无效' }));
    }
  }

  private async respond(client: socket.TCPSocketConnection, status: number, body: string): Promise<void> {
    const reason = status === 200 ? 'OK' : status === 202 ? 'Accepted' :
      status === 204 ? 'No Content' : status === 404 ? 'Not Found' : 'Error';
    const data = new util.TextEncoder().encodeInto(body);
    const headers = `HTTP/1.1 ${status} ${reason}\r\n` +
      'Content-Type: application/json; charset=utf-8\r\n' +
      `Content-Length: ${data.byteLength}\r\n` +
      'Cache-Control: no-store\r\n' +
      'Access-Control-Allow-Origin: *\r\n' +
      'Access-Control-Allow-Headers: Content-Type, X-CareJournal-Alias, X-CareJournal-Fingerprint\r\n' +
      'Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n' +
      'Connection: close\r\n\r\n';
    const headerBytes = new util.TextEncoder().encodeInto(headers);
    const response = new Uint8Array(headerBytes.byteLength + data.byteLength);
    response.set(headerBytes, 0);
    response.set(data, headerBytes.byteLength);
    await client.send({ data: response.buffer });
    await client.close();
  }

  private async requestJson(
    method: http.RequestMethod,
    url: string,
    body: string,
    timeout: number
  ): Promise<Record<string, Object>> {
    const response = await this.rawRequest(method, url, body, timeout);
    const parsed = JSON.parse(response.body) as Record<string, Object>;
    if (response.status < 200 || response.status >= 300) {
      throw new Error(String(parsed['error'] ?? `远程设备返回 ${response.status}`));
    }
    return parsed;
  }

  private async rawRequest(
    method: http.RequestMethod,
    url: string,
    body: string,
    timeout: number
  ): Promise<RawHttpResult> {
    const client = http.createHttp();
    try {
      const response = await client.request(url, {
        method,
        header: {
          'Content-Type': 'application/json',
          'X-CareJournal-Alias': encodeURIComponent(this.alias),
          'X-CareJournal-Fingerprint': this.fingerprint
        },
        extraData: body || undefined,
        connectTimeout: timeout,
        readTimeout: timeout,
        expectDataType: http.HttpDataType.STRING
      });
      return {
        status: response.responseCode,
        body: String(response.result ?? '')
      };
    } finally {
      client.destroy();
    }
  }

  private upsertPeer(
    fingerprint: string,
    alias: string,
    deviceType: string,
    publicKey: string,
    host: string,
    port: number
  ): void {
    if (!fingerprint || !publicKey || fingerprint === this.fingerprint || !host) return;
    this.peers.set(fingerprint, {
      fingerprint,
      alias: alias || 'CareJournal 设备',
      deviceType: deviceType === 'web' ? 'web' : 'mobile',
      publicKey,
      host,
      port: port || PORT,
      lastSeen: Date.now()
    });
    this.emitPeers();
  }

  private expirePeers(): void {
    const cutoff = Date.now() - PEER_TTL_MS;
    this.peers.forEach((peer, fingerprint) => {
      if (peer.lastSeen < cutoff) this.peers.delete(fingerprint);
    });
  }

  private expirePending(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    this.pending.forEach((request, requestId) => {
      if (request.createdAt < cutoff) this.pending.delete(requestId);
    });
  }

  private sortedPeers(): LanPeer[] {
    this.expirePeers();
    return Array.from(this.peers.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  private emitPeers(): void {
    this.emit(new PeersChangedEvent(this.sortedPeers()));
  }
}
