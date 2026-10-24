import { SCHEMA_VERSION, validateDataset } from "../shared/dataSchema.js";

export const emptyDataset = () => ({
  schema_version: SCHEMA_VERSION,
  signs: [],
  samples: [],
});
const canonical = (value) =>
  JSON.stringify(value, function (key, item) {
    return item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item;
  });
export function mergeDatasets(existing, incoming) {
  const errors = [...validateDataset(existing), ...validateDataset(incoming)];
  if (errors.length) throw new Error(errors.slice(0, 8).join("\n"));
  let duplicates = 0;
  const merge = (a, b, key) => {
    const map = new Map(a.map((v) => [v[key], v]));
    for (const item of b) {
      if (map.has(item[key])) {
        if (canonical(map.get(item[key])) !== canonical(item))
          throw new Error(`ID 충돌: ${item[key]} — 기존 내용과 다릅니다.`);
        duplicates++;
      } else map.set(item[key], item);
    }
    return [...map.values()];
  };
  const dataset = {
    schema_version: SCHEMA_VERSION,
    signs: merge(existing.signs, incoming.signs, "sign_id"),
    samples: merge(existing.samples, incoming.samples, "sample_id"),
  };
  const combinedErrors = validateDataset(dataset);
  if (combinedErrors.length)
    throw new Error(combinedErrors.slice(0, 8).join("\n"));
  return {
    dataset,
    duplicates,
    added: dataset.samples.length - existing.samples.length,
  };
}

export class DatasetManager {
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("signbridge-ai", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("signs", { keyPath: "sign_id" });
        db.createObjectStore("samples", { keyPath: "sample_id" });
        db.createObjectStore("settings");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("다른 탭을 닫고 다시 시도하세요."));
    });
    this.db.onversionchange = () => this.db.close();
    return this;
  }
  async read() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["signs", "samples"], "readonly");
      const signs = tx.objectStore("signs").getAll(),
        samples = tx.objectStore("samples").getAll();
      tx.oncomplete = () =>
        resolve({
          schema_version: SCHEMA_VERSION,
          signs: signs.result,
          samples: samples.result,
        });
      tx.onerror = () => reject(tx.error);
    });
  }
  async merge(incoming) {
    // Read, validate, and insert in one transaction: concurrent tabs cannot lose data.
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["signs", "samples"], "readwrite");
      const signs = tx.objectStore("signs").getAll(),
        samples = tx.objectStore("samples").getAll();
      let result, failure;
      samples.onsuccess = () => {
        try {
          result = mergeDatasets(
            {
              schema_version: SCHEMA_VERSION,
              signs: signs.result,
              samples: samples.result,
            },
            incoming,
          );
          for (const sign of result.dataset.signs)
            tx.objectStore("signs").put(sign);
          for (const sample of incoming.samples)
            tx.objectStore("samples").put(sample);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(failure ?? tx.error ?? new Error("저장 작업이 취소되었습니다."));
      tx.onerror = () => {
        /* onabort reports quota and transaction failures */
      };
    });
  }
  async deleteSample(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("samples", "readwrite");
      tx.objectStore("samples").delete(id);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
  }
  async deleteSign(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(["signs", "samples"], "readwrite");
      let failure;
      const request = tx.objectStore("samples").getAll();
      request.onsuccess = () => {
        if (request.result.some((s) => s.sign_id === id)) {
          failure = new Error(
            "시퀀스가 있는 단어는 삭제할 수 없습니다. 해당 시퀀스를 먼저 확인하세요.",
          );
          tx.abort();
        } else tx.objectStore("signs").delete(id);
      };
      tx.oncomplete = resolve;
      tx.onabort = () => reject(failure ?? tx.error);
    });
  }
  async setting(key, value) {
    const writing = value !== undefined;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(
        "settings",
        writing ? "readwrite" : "readonly",
      );
      const request = writing
        ? tx.objectStore("settings").put(value, key)
        : tx.objectStore("settings").get(key);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    });
  }
  async settingsWithPrefix(prefix) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("settings", "readonly"),
        records = new Map();
      const request = tx
        .objectStore("settings")
        .openCursor(IDBKeyRange.bound(prefix, prefix + "\uffff"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          records.set(cursor.key, cursor.value);
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve(records);
      tx.onabort = () => reject(tx.error);
    });
  }
  close() {
    this.db?.close();
  }
}
