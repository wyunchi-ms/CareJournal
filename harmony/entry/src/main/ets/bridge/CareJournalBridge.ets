import { common } from '@kit.AbilityKit';
import { deviceInfo } from '@kit.BasicServicesKit';
import { picker } from '@kit.CoreFileKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { EntityStore } from '../services/EntityStore';
import { AssetStore } from '../services/AssetStore';
import { postJson } from '../services/NativeHttp';
import { LanSyncService } from '../services/LanSyncService';

export class CareJournalBridge {
  private context: common.UIAbilityContext;
  private readonly entities: EntityStore;
  private readonly assets: AssetStore;
  private readonly lan: LanSyncService;
  private eventSink: (detail: object) => void = () => {};

  constructor(context: common.UIAbilityContext) {
    this.context = context;
    this.entities = new EntityStore(context);
    this.assets = new AssetStore(context);
    this.lan = new LanSyncService(context, (detail) => this.eventSink(detail));
  }

  setEventSink(sink: (detail: object) => void): void {
    this.eventSink = sink;
  }

  shutdown(): Promise<void> {
    this.eventSink = () => {};
    return this.lan.stop();
  }

  async getPlatformInfo(): Promise<string> {
    return JSON.stringify({
      platform: 'harmonyos',
      version: deviceInfo.osFullName,
      model: deviceInfo.productModel
    });
  }

  exitApp(): Promise<void> {
    return this.context.terminateSelf();
  }

  listEntities(kind: string): Promise<string> {
    return this.entities.list(kind);
  }

  putEntity(kind: string, id: string, updatedAt: string, payload: string): Promise<void> {
    return this.entities.put(kind, id, updatedAt, payload);
  }

  removeEntity(kind: string, id: string): Promise<void> {
    return this.entities.remove(kind, id);
  }

  replaceEntities(kind: string, entries: string): Promise<void> {
    return this.entities.replace(kind, entries);
  }

  removeCompletedOcrJobs(): Promise<void> {
    return this.entities.removeCompletedOcrJobs();
  }

  persistImage(id: string, mimeType: string, dataUrl: string, sha256: string): Promise<string> {
    return this.assets.persist(id, mimeType, dataUrl, sha256);
  }

  readImage(storagePath: string): Promise<string> {
    return this.assets.read(storagePath);
  }

  garbageCollectImages(storagePaths: string): Promise<number> {
    return this.assets.garbageCollect(storagePaths);
  }

  async pickFiles(serializedMimeTypes: string): Promise<string> {
    const mimeTypes = JSON.parse(serializedMimeTypes) as string[];
    const viewPicker = new picker.DocumentViewPicker(this.context);
    const uris = await viewPicker.select({
      maxSelectNumber: 100,
      fileSuffixFilters: mimeTypes.includes('application/pdf')
        ? ['图片与 PDF|.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf']
        : ['图片|.jpg,.jpeg,.png,.webp,.heic,.heif']
    });
    return JSON.stringify(uris);
  }

  async saveFile(filename: string, _mimeType: string, base64: string): Promise<string> {
    const viewPicker = new picker.DocumentViewPicker(this.context);
    const uris = await viewPicker.save({ newFileNames: [filename] });
    if (!uris.length) throw new Error('未选择保存位置');
    const file = fs.openSync(uris[0], fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
    try {
      const bytes = new util.Base64Helper().decodeSync(base64);
      fs.writeSync(file.fd, bytes.buffer);
    } finally {
      fs.closeSync(file);
    }
    return uris[0];
  }

  httpPost(
    url: string,
    headers: string,
    body: string,
    connectTimeout: number,
    readTimeout: number
  ): Promise<string> {
    return postJson(url, headers, body, connectTimeout, readTimeout);
  }

  lanStart(alias: string, publicKey: string): Promise<string> {
    return this.lan.start(alias, publicKey);
  }

  lanStop(): Promise<void> {
    return this.lan.stop();
  }

  lanRefresh(): Promise<void> {
    return this.lan.refresh();
  }

  async lanListPeers(): Promise<string> {
    return this.lan.listPeers();
  }

  lanSendSync(host: string, port: number, envelope: string): Promise<string> {
    return this.lan.sendSync(host, port, envelope);
  }

  lanSetTransferActive(active: boolean): Promise<void> {
    return this.lan.setTransferActive(active);
  }

  async lanCompleteSync(requestId: string, envelope: string): Promise<void> {
    this.lan.complete(requestId, envelope);
  }

  async lanRejectSync(requestId: string, error: string): Promise<void> {
    this.lan.reject(requestId, error);
  }
}
