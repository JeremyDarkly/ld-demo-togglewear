import type {
  DataKind,
  LDFeatureStore,
  LDFeatureStoreDataStorage,
  LDFeatureStoreItem,
  LDFeatureStoreKindData,
  LDKeyedFeatureStoreItem,
} from "@launchdarkly/node-server-sdk";

// The server client's flag store: the SDK's own in-memory store, which it
// does not export, rewritten so the demo generator can read a flag's
// targeting as well as evaluate it.
//
// That is how the generator knows a guarded rollout is over without an API
// key. While one runs, the flag's default rule is a percentage rollout; once
// it completes or is rolled back, the rule serves a single variation again.
// results_generator.py asks the REST API the same question, which needs a key
// the browser-facing app must never hold — whereas the SDK already streams
// every change to the flag into this store.
export class FlagStore implements LDFeatureStore {
  private data: LDFeatureStoreDataStorage = {};
  private initCalled = false;

  get(
    kind: DataKind,
    key: string,
    callback: (res: LDFeatureStoreItem | null) => void,
  ) {
    const item = this.data[kind.namespace]?.[key];
    callback(item && !item.deleted ? item : null);
  }

  all(kind: DataKind, callback: (res: LDFeatureStoreKindData) => void) {
    const result: LDFeatureStoreKindData = {};
    for (const [key, item] of Object.entries(this.data[kind.namespace] ?? {})) {
      if (item && !item.deleted) result[key] = item;
    }
    callback(result);
  }

  init(allData: LDFeatureStoreDataStorage, callback: (err?: Error) => void) {
    this.data = allData;
    this.initCalled = true;
    callback();
  }

  delete(kind: DataKind, key: string, version: number, callback: () => void) {
    this.upsert(kind, { key, version, deleted: true }, () => callback());
  }

  upsert(
    kind: DataKind,
    data: LDKeyedFeatureStoreItem,
    callback: (err?: Error) => void,
  ) {
    // A copy rather than an edit in place, as the SDK's store does, so an
    // evaluation already reading the old data is not changed underneath it.
    const items = { ...(this.data[kind.namespace] ?? {}) };
    const old = items[data.key];
    if (!old || old.version < data.version) items[data.key] = data;
    this.data = { ...this.data, [kind.namespace]: items };
    callback();
  }

  initialized(callback: (isInitialized: boolean) => void) {
    callback(this.initCalled);
  }

  close() {}

  getDescription() {
    return "memory";
  }

  // Whether the flag is on with a percentage rollout on its default rule,
  // which is what a guarded rollout is while it runs.
  rolloutRunning(flagKey: string) {
    const flag = this.data.features?.[flagKey];
    return Boolean(flag && !flag.deleted && flag.on && flag.fallthrough?.rollout);
  }
}
