import { common } from '@kit.AbilityKit';
import { http, socket } from '@kit.NetworkKit';
import { preferences } from '@kit.ArkData';
import { util } from '@kit.ArkTS';

const PORT: number = 53318;
const BROADCAST_ADDRESS: string = '255.255.255.255';
const PEER_TTL_MS: number = 16000;

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
}

interface HttpRequest {
  method: string;
  path: string;
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

  constructor(requestId: string, envelope: string) {
    this.requestId = requestId;
    this.envelope = envelope;
  }
}

export class LanSyncService {
  private context: common.UIAbilityContext;
  private emit: (detail: object) => void;
  private udp?: socket.UDPSocket;
  private server?: socket.TCPSocketServer;
  private peers: Map<string, LanPeer> = new Map();
  private pending: Map<string, PendingRequest> = new Map();
  private clientBuffers: Map<socket.TCPSocketConnection, string> = new Map();
  private alias: string = 'CareJournal 鸿蒙设备';
  private publicKey: string = '';
  private fingerprint: string = '';
  private active: boolean = false;
  private announceTimer: number = -1;

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
    this.alias = alias;
    this.publicKey = publicKey;
    const store = await preferences.getPreferences(this.context, 'carejournal_lan');
    this.fingerprint = String(await store.get('fingerprint', ''));
    if (!this.fingerprint) {
      this.fingerprint = util.generateRandomUUID(true);
      await store.put('fingerprint', this.fingerprint);
      await store.flush();
    }
    this.active = true;
    await this.startServer();
    await this.startDiscovery();
    this.announceTimer = setInterval(() => this.announce(false), 5000);
    await this.announce(true);
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
    if (this.announceTimer >= 0) clearInterval(this.announceTimer);
    this.announceTimer = -1;
    if (this.udp) await this.udp.close().catch(() => undefined);
    if (this.server) await this.server.close().catch(() => undefined);
    this.udp = undefined;
    this.server = undefined;
    this.peers.clear();
    this.pending.clear();
    this.clientBuffers.clear();
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

  async sendSync(host: string, port: number, envelope: string): Promise<string> {
    const known = this.sortedPeers().some((peer) => peer.host === host && peer.port === port);
    if (!known) throw new Error('目标设备不在当前发现列表中，请刷新后重试');
    const base = `http://${host}:${port}`;
    const created = await this.requestJson(http.RequestMethod.POST, `${base}/carejournal/v1/sync`, envelope, 30000);
    const requestId = String(created['requestId'] ?? '');
    if (!requestId) throw new Error('目标设备未返回同步请求编号');
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 850));
      const result = await this.rawRequest(http.RequestMethod.GET, `${base}/carejournal/v1/result/${requestId}`, '', 10000);
      const body = JSON.parse(result.body) as Record<string, object>;
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
    const udp = socket.constructUDPSocketInstance();
    this.udp = udp;
    udp.on('message', (event: socket.SocketMessageInfo) => {
      if (!this.active) return;
      try {
        const text = new util.TextDecoder().decodeToString(new Uint8Array(event.message));
        const advertisement = JSON.parse(text) as PeerAdvertisement;
        if (advertisement.app !== 'carejournal' || advertisement.version !== 2) return;
        if (!advertisement.fingerprint || !advertisement.publicKey ||
          advertisement.fingerprint === this.fingerprint) return;
        const host = event.remoteInfo.address;
        this.peers.set(advertisement.fingerprint, {
          fingerprint: advertisement.fingerprint,
          alias: advertisement.alias || 'CareJournal 设备',
          deviceType: advertisement.deviceType === 'web' ? 'web' : 'mobile',
          publicKey: advertisement.publicKey,
          host,
          port: advertisement.port || PORT,
          lastSeen: Date.now()
        });
        this.emitPeers();
        if (advertisement.announce) this.announce(false);
      } catch (_) {
        // Ignore unrelated broadcast traffic.
      }
    });
    await udp.bind({ address: '0.0.0.0', port: PORT });
    await udp.setExtraOptions({
      reuseAddress: true,
      broadcast: true,
      receiveBufferSize: 1024 * 1024,
      sendBufferSize: 1024 * 1024
    });
  }

  private async announce(requestResponse: boolean): Promise<void> {
    if (!this.active || !this.udp) return;
    const payload: PeerAdvertisement = {
      app: 'carejournal',
      version: 2,
      alias: this.alias,
      deviceType: 'mobile',
      fingerprint: this.fingerprint,
      publicKey: this.publicKey,
      port: PORT,
      announce: requestResponse
    };
    await this.udp.send({
      data: JSON.stringify(payload),
      address: { address: BROADCAST_ADDRESS, port: PORT }
    }).catch(() => undefined);
  }

  private async startServer(): Promise<void> {
    const server = socket.constructTCPSocketServerInstance();
    this.server = server;
    server.on('connect', (client: socket.TCPSocketConnection) => {
      this.clientBuffers.set(client, '');
      client.on('message', (event: socket.SocketMessageInfo) => {
        const chunk = new util.TextDecoder().decodeToString(new Uint8Array(event.message));
        const combined = `${this.clientBuffers.get(client) ?? ''}${chunk}`;
        this.clientBuffers.set(client, combined);
        const request = this.parseRequest(combined);
        if (request) {
          this.clientBuffers.delete(client);
          this.handleRequest(client, request);
        }
      });
      client.on('close', () => this.clientBuffers.delete(client));
    });
    await server.listen({ address: '0.0.0.0', port: PORT });
  }

  private parseRequest(raw: string): HttpRequest | undefined {
    const separator = raw.indexOf('\r\n\r\n');
    if (separator < 0) return undefined;
    const headerText = raw.slice(0, separator);
    const lines = headerText.split('\r\n');
    const requestLine = lines[0].split(' ');
    const lengthLine = lines.find((line) => line.toLowerCase().startsWith('content-length:'));
    const length = lengthLine ? Number(lengthLine.slice(lengthLine.indexOf(':') + 1).trim()) : 0;
    const body = raw.slice(separator + 4);
    if (new util.TextEncoder().encodeInto(body).byteLength < length) return undefined;
    return { method: requestLine[0], path: requestLine[1], body };
  }

  private async handleRequest(client: socket.TCPSocketConnection, request: HttpRequest): Promise<void> {
    try {
      if (request.method === 'OPTIONS') {
        await this.respond(client, 204, '');
        return;
      }
      if (request.method === 'POST' && request.path === '/carejournal/v1/sync') {
        JSON.parse(request.body);
        const requestId = util.generateRandomUUID(true);
        this.pending.set(requestId, new PendingRequest());
        this.emit(new SyncRequestEvent(requestId, request.body));
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
      status === 204 ? 'No Content' : 'Error';
    const length = new util.TextEncoder().encodeInto(body).byteLength;
    const response = `HTTP/1.1 ${status} ${reason}\r\n` +
      'Content-Type: application/json; charset=utf-8\r\n' +
      `Content-Length: ${length}\r\n` +
      'Cache-Control: no-store\r\n' +
      'Access-Control-Allow-Origin: *\r\n' +
      'Connection: close\r\n\r\n' +
      body;
    await client.send({ data: response });
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
        header: { 'Content-Type': 'application/json' },
        extraData: body || undefined,
        connectTimeout: timeout,
        readTimeout: timeout,
        expectDataType: http.HttpDataType.STRING
      });
      const result: RawHttpResult = {
        status: response.responseCode,
        body: String(response.result ?? '')
      };
      return result;
    } finally {
      client.destroy();
    }
  }

  private expirePeers(): void {
    const cutoff = Date.now() - PEER_TTL_MS;
    this.peers.forEach((peer, fingerprint) => {
      if (peer.lastSeen < cutoff) this.peers.delete(fingerprint);
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
