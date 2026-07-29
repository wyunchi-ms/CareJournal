import { relationalStore } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';

interface ReplacementEntity {
  id: string;
  updatedAt: string;
  payload: object;
}

export class EntityStore {
  private context: common.UIAbilityContext;
  private store?: relationalStore.RdbStore;
  private opening?: Promise<relationalStore.RdbStore>;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  private async db(): Promise<relationalStore.RdbStore> {
    if (this.store) return this.store;
    if (!this.opening) {
      this.opening = relationalStore.getRdbStore(this.context, {
        name: 'carejournal.db',
        securityLevel: relationalStore.SecurityLevel.S1
      }).then(async (store) => {
        await store.executeSql(`CREATE TABLE IF NOT EXISTS entities (
          key TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          payload TEXT NOT NULL
        )`);
        await store.executeSql('CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities(kind)');
        this.store = store;
        return store;
      });
    }
    return this.opening;
  }

  async list(kind: string): Promise<string> {
    const result = await (await this.db()).querySql(
      'SELECT payload FROM entities WHERE kind = ? ORDER BY updated_at DESC',
      [kind]
    );
    const rows: object[] = [];
    try {
      while (result.goToNextRow()) rows.push(JSON.parse(result.getString(0)));
    } finally {
      result.close();
    }
    return JSON.stringify(rows);
  }

  async put(kind: string, id: string, updatedAt: string, payload: string): Promise<void> {
    await (await this.db()).executeSql(
      'INSERT OR REPLACE INTO entities (key, kind, entity_id, updated_at, payload) VALUES (?, ?, ?, ?, ?)',
      [`${kind}:${id}`, kind, id, updatedAt, payload]
    );
  }

  async remove(kind: string, id: string): Promise<void> {
    await (await this.db()).executeSql('DELETE FROM entities WHERE key = ?', [`${kind}:${id}`]);
  }

  async replace(kind: string, serializedEntries: string): Promise<void> {
    const entries = JSON.parse(serializedEntries) as ReplacementEntity[];
    const store = await this.db();
    await store.beginTransaction();
    try {
      await store.executeSql('DELETE FROM entities WHERE kind = ?', [kind]);
      for (const entry of entries) {
        await store.executeSql(
          'INSERT OR REPLACE INTO entities (key, kind, entity_id, updated_at, payload) VALUES (?, ?, ?, ?, ?)',
          [`${kind}:${entry.id}`, kind, entry.id, entry.updatedAt, JSON.stringify(entry.payload)]
        );
      }
      await store.commit();
    } catch (error) {
      await store.rollBack();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async removeCompletedOcrJobs(): Promise<void> {
    await (await this.db()).executeSql(
      `DELETE FROM entities
       WHERE kind = 'ocrJob' AND json_extract(payload, '$.status') = 'completed'`
    );
  }
}
