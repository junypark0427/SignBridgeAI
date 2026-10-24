import { tensorflow, makeMetadata } from "./modelManager.js";
import { sequenceInput, TIME_STEPS, INPUT_SIZE } from "./sequenceInput.js";

export class SignTrainer {
  constructor() {
    this.model = null;
    this.busy = false;
    this.cancelled = false;
  }
  stop() {
    this.cancelled = true;
    if (this.model) this.model.stopTraining = true;
  }
  async train(
    prepared,
    { language, allSigns, glosses = {}, epochs = 30, onEpoch = () => {} },
  ) {
    if (this.busy) throw new Error("이미 학습 중입니다.");
    if (!Number.isInteger(epochs) || epochs < 1 || epochs > 200)
      throw new Error("Epoch은 1~200으로 설정하세요.");
    this.busy = true;
    this.cancelled = false;
    let tf;
    const ids = prepared.signs.map((s) => s.sign_id);
    let trainX, trainY, valX, valY;
    try {
      tf = await tensorflow();
      if (this.cancelled) throw new Error("학습을 중단했습니다.");
      this.model?.dispose();
      this.model = tf.sequential();
      this.model.add(
        tf.layers.conv1d({
          inputShape: [TIME_STEPS, INPUT_SIZE],
          filters: 24,
          kernelSize: 3,
          padding: "same",
          activation: "relu",
        }),
      );
      this.model.add(
        tf.layers.conv1d({
          filters: 24,
          kernelSize: 3,
          strides: 2,
          padding: "same",
          activation: "relu",
        }),
      );
      this.model.add(tf.layers.flatten());
      this.model.add(tf.layers.dense({ units: 32, activation: "relu" }));
      this.model.add(tf.layers.dropout({ rate: 0.2 }));
      this.model.add(
        tf.layers.dense({ units: ids.length, activation: "softmax" }),
      );
      this.model.compile({
        optimizer: tf.train.adam(0.001),
        loss: "categoricalCrossentropy",
        metrics: ["accuracy"],
      });
      trainX = tf.tensor3d(prepared.train.map(sequenceInput));
      valX = tf.tensor3d(prepared.validation.map(sequenceInput));
      const labels = (samples) =>
        tf.tidy(() =>
          tf.oneHot(
            tf.tensor1d(
              samples.map((s) => ids.indexOf(s.sign_id)),
              "int32",
            ),
            ids.length,
          ),
        );
      trainY = labels(prepared.train);
      valY = labels(prepared.validation);
      const history = await this.model.fit(trainX, trainY, {
        epochs,
        batchSize: Math.min(16, prepared.train.length),
        validationData: [valX, valY],
        shuffle: true,
        yieldEvery: "batch",
        callbacks: {
          onBatchEnd: async () => {
            if (this.cancelled) this.model.stopTraining = true;
            await tf.nextFrame();
          },
          onEpochEnd: async (epoch, logs) => {
            await onEpoch(epoch + 1, logs);
            if (this.cancelled) this.model.stopTraining = true;
          },
        },
      });
      if (this.cancelled) {
        this.model.dispose();
        this.model = null;
        throw new Error(
          "학습을 중단했습니다. 미완성 모델은 저장하지 않았습니다.",
        );
      }
      const evaluated = this.model.evaluate(valX, valY),
        values = Array.isArray(evaluated) ? evaluated : [evaluated];
      const metrics = await Promise.all(
        values.map(async (tensor) => {
          const result = (await tensor.data())[0];
          tensor.dispose();
          return result;
        }),
      );
      const metadata = makeMetadata(
        language,
        prepared.signs,
        allSigns,
        glosses,
        prepared,
      );
      metadata.validation = { loss: metrics[0], accuracy: metrics[1] };
      return {
        model: this.model,
        metadata,
        history: history.history,
        validation: metadata.validation,
      };
    } catch (error) {
      this.model?.dispose();
      this.model = null;
      throw error;
    } finally {
      [trainX, trainY, valX, valY].forEach((t) => t?.dispose());
      this.busy = false;
    }
  }
}
