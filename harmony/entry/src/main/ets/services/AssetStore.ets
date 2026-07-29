import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';

interface PersistedImageResult {
  mimeType: string;
  sha256: string;
  storagePath: string;
  localUri: string;
}

export class AssetStore {
  private readonly root: string;
  private readonly base64 = new util.Base64Helper();

  constructor(context: common.UIAbilityContext) {
    this.root = `${context.filesDir}/assets`;
    try {
      fs.mkdirSync(this.root, true);
    } catch (_) {
      // The directory already exists.
    }
  }

  private extension(mimeType: string): string {
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType === 'image/png') return 'png';
    if (mimeType === 'image/webp') return 'webp';
    if (mimeType === 'image/heic' || mimeType === 'image/heif') return 'heic';
    return 'jpg';
  }

  async persist(id: string, mimeType: string, dataUrl: string, sha256: string): Promise<string> {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) throw new Error('素材内容格式无效');
    const bytes = this.base64.decodeSync(dataUrl.slice(comma + 1));
    const storagePath = `${this.root}/${id}.${this.extension(mimeType)}`;
    const file = fs.openSync(storagePath, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
    try {
      fs.writeSync(file.fd, bytes.buffer);
    } finally {
      fs.closeSync(file);
    }
    const result: PersistedImageResult = {
      mimeType,
      sha256,
      storagePath,
      localUri: `file://${storagePath}`
    };
    return JSON.stringify(result);
  }

  async read(storagePath: string): Promise<string> {
    const file = fs.openSync(storagePath, fs.OpenMode.READ_ONLY);
    try {
      const stat = fs.statSync(storagePath);
      const buffer = new ArrayBuffer(stat.size);
      fs.readSync(file.fd, buffer);
      const mimeType = this.mimeType(storagePath);
      return JSON.stringify({
        mimeType,
        dataUrl: `data:${mimeType};base64,${this.base64.encodeToStringSync(new Uint8Array(buffer))}`
      });
    } finally {
      fs.closeSync(file);
    }
  }

  async garbageCollect(serializedPaths: string): Promise<number> {
    const retained = new Set(JSON.parse(serializedPaths) as string[]);
    let deleted = 0;
    for (const name of fs.listFileSync(this.root)) {
      const path = `${this.root}/${name}`;
      if (!retained.has(path)) {
        fs.unlinkSync(path);
        deleted += 1;
      }
    }
    return deleted;
  }

  private mimeType(path: string): string {
    if (path.endsWith('.pdf')) return 'application/pdf';
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.webp')) return 'image/webp';
    if (path.endsWith('.heic')) return 'image/heic';
    return 'image/jpeg';
  }
}
