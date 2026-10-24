import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

export const CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];
export class HandTracker {
  constructor(
    onStatus,
    {
      resolve = (path) => FilesetResolver.forVisionTasks(path),
      create = (files, options) =>
        HandLandmarker.createFromOptions(files, options),
      baseUrl = import.meta.env?.BASE_URL ?? "/",
    } = {},
  ) {
    Object.assign(this, { onStatus, resolve, create, baseUrl });
    this.task = null;
    this.lastVideoTime = -1;
    this.lastTimestamp = -1;
    this.generation = 0;
    this.initializing = null;
  }
  async init() {
    if (this.task) return;
    if (this.initializing) return this.initializing;
    const generation = this.generation;
    const pending = this.initialize(generation);
    this.initializing = pending;
    try {
      await pending;
    } finally {
      if (this.initializing === pending) this.initializing = null;
    }
  }
  async initialize(generation) {
    this.onStatus("초기화 중");
    try {
      const files = await this.resolve(`${this.baseUrl}wasm`);
      if (generation !== this.generation) throw new Error("초기화 취소");
      for (const delegate of ["GPU", "CPU"]) {
        try {
          const task = await this.create(files, {
            baseOptions: {
              modelAssetPath: `${this.baseUrl}models/hand_landmarker.task`,
              delegate,
            },
            runningMode: "VIDEO",
            numHands: 2,
          });
          if (generation !== this.generation) {
            task.close();
            throw new Error("초기화 취소");
          }
          this.task = task;
          this.onStatus(`${delegate} 준비됨`);
          return;
        } catch (error) {
          if (generation !== this.generation || delegate === "CPU") throw error;
        }
      }
    } catch (error) {
      if (generation !== this.generation)
        throw new Error("MediaPipe 초기화가 취소되었습니다.");
      this.onStatus("초기화 실패");
      throw new Error(
        `MediaPipe 초기화 실패. 로컬 모델·WASM 파일과 브라우저를 확인하세요. ${error.message}`,
      );
    }
  }
  detect(video, timestamp) {
    if (
      !this.task ||
      video.readyState < 2 ||
      video.currentTime === this.lastVideoTime
    )
      return null;
    this.lastVideoTime = video.currentTime;
    const time = Math.max(timestamp, this.lastTimestamp + 0.001);
    this.lastTimestamp = time;
    const result = this.task.detectForVideo(video, time);
    return result.landmarks.map((landmarks, i) => {
      const category = result.handedness[i]?.[0];
      return {
        handedness: ["Left", "Right"].includes(category?.categoryName)
          ? category.categoryName
          : "Unknown",
        score: category?.score ?? 0,
        landmarks: landmarks.map(({ x, y, z }) => ({ x, y, z })),
      };
    });
  }
  resetVideo() {
    this.lastVideoTime = -1;
  }
  close() {
    this.generation++;
    this.initializing = null;
    this.task?.close();
    this.task = null;
  }
}
