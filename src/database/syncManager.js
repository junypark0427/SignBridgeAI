import { sampleFingerprint } from "./sampleRepository.js";
export class SyncManager {
  constructor({
    store,
    repository,
    target,
    online = () => navigator.onLine,
    onChange = () => {},
  }) {
    Object.assign(this, { store, repository, target, online, onChange });
    this.running = null;
    this.again = false;
  }
  key(id) {
    return `cloud-sync:${this.target}:${id}`;
  }
  async states(samples, signs) {
    const records = await this.store.settingsWithPrefix(
      `cloud-sync:${this.target}:`,
    );
    signs ??= (await this.store.read()).signs;
    return new Map(
      await Promise.all(
        samples.map(async (s) => {
          const fingerprint = await sampleFingerprint(
            s,
            signs.find((sign) => sign.sign_id === s.sign_id),
          );
          const record = records.get(this.key(s.sample_id));
          return [
            s.sample_id,
            record?.fingerprint === fingerprint
              ? record
              : { state: "pending", attempts: 0, fingerprint },
          ];
        }),
      ),
    );
  }
  async set(id, record) {
    await this.store.setting(this.key(id), record);
    await this.onChange();
  }
  run() {
    this.again = true;
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  async drain() {
    if (!this.repository || !this.online()) {
      await this.onChange();
      return;
    }
    do {
      this.again = false;
      const dataset = await this.store.read(),
        states = await this.states(dataset.samples, dataset.signs);
      for (const sample of dataset.samples) {
        if (!this.online()) break;
        const previous = states.get(sample.sample_id);
        if (previous.state === "synced") continue;
        const record = {
          state: "uploading",
          fingerprint: previous.fingerprint,
          attempts: (previous.attempts ?? 0) + 1,
          last_attempt_at: new Date().toISOString(),
          error: null,
        };
        await this.set(sample.sample_id, record);
        try {
          const sign = dataset.signs.find((s) => s.sign_id === sample.sign_id);
          await this.repository.upload(sample, sign);
          await this.set(sample.sample_id, {
            ...record,
            state: "synced",
            synced_at: new Date().toISOString(),
          });
        } catch (error) {
          await this.set(sample.sample_id, {
            ...record,
            state: "error",
            error: String(error?.message ?? error).slice(0, 400),
          });
        }
      }
    } while (this.again && this.online());
    await this.onChange();
  }
}
