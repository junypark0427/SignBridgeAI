export function cameraError(error) {
  const messages = {
    NotAllowedError: '카메라 접근이 거부되었습니다. 브라우저의 사이트 권한에서 카메라를 허용하세요.',
    NotFoundError: '사용 가능한 카메라가 없습니다. 장치를 연결해 주세요.',
    NotReadableError: '카메라를 열 수 없습니다. 다른 앱의 카메라 사용 여부를 확인하세요.',
    OverconstrainedError: '선택한 카메라를 사용할 수 없습니다. 장치 목록을 새로고침하세요.',
    SecurityError: '카메라는 HTTPS 또는 localhost에서 사용할 수 있습니다.',
  };
  return messages[error.name] ?? `카메라 오류: ${error.message}`;
}
export class CameraManager {
  constructor(video, onEnded) { this.video = video; this.onEnded = onEnded; this.stream = null; this.generation = 0; }
  async devices() {
    if (!navigator.mediaDevices?.enumerateDevices) throw new Error('카메라를 지원하는 브라우저에서 HTTPS 또는 localhost로 접속하세요.');
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  }
  async start(deviceId) {
    this.stop();
    const generation = this.generation;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('카메라는 HTTPS 또는 localhost에서 사용할 수 있습니다.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
      if (generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); throw new Error('카메라 시작이 취소되었습니다.'); }
      this.stream = stream;
      this.video.srcObject = this.stream;
      this.stream.getVideoTracks()[0].addEventListener('ended', this.onEnded, { once: true });
      await this.video.play();
      if (generation !== this.generation) throw new Error('카메라 시작이 취소되었습니다.');
      return { width: this.video.videoWidth, height: this.video.videoHeight, mirrored_input: false };
    } catch (error) { this.stop(); throw new Error(cameraError(error)); }
  }
  stop() {
    this.generation++;
    this.stream?.getTracks().forEach((track) => { track.removeEventListener('ended', this.onEnded); track.stop(); });
    this.stream = null;
    this.video.srcObject = null;
  }
}
