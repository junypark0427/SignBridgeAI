import './style.css';
import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';

const startButton = document.querySelector('#startButton');
const stopButton = document.querySelector('#stopButton');
const video = document.querySelector('#cameraVideo');
const placeholder = document.querySelector('#cameraPlaceholder');
const liveLabel = document.querySelector('#cameraLiveLabel');
const resultEmoji = document.querySelector('#resultEmoji');
const resultText = document.querySelector('#resultText');
const resultHint = document.querySelector('#resultHint');
const confidenceBar = document.querySelector('#confidenceBar');
const confidenceText = document.querySelector('#confidenceText');
const historyList = document.querySelector('#historyList');
const toast = document.querySelector('#toast');
const gestureGrid = document.querySelector('.gesture-grid');
const toggleGestureFormButton = document.querySelector('#toggleGestureForm');
const gestureForm = document.querySelector('#gestureForm');
const closeGestureFormButton = document.querySelector('#closeGestureForm');
const gestureNameInput = document.querySelector('#gestureName');
const gestureMeaningInput = document.querySelector('#gestureMeaning');
const gestureEmojiInput = document.querySelector('#gestureEmoji');
const captureSampleButton = document.querySelector('#captureSample');
const sampleCount = document.querySelector('#sampleCount');
const saveGestureButton = document.querySelector('#saveGesture');
const exportDatasetButton = document.querySelector('#exportDataset');
const datasetStatus = document.querySelector('#datasetStatus');

let cameraStream = null;
let recognizer = null;
let animationFrame = null;
let lastVideoTime = -1;
let lastGestureKey = '';
let lastHistoryAt = 0;
let toastTimeout;
let loadingModel = false;
let database = null;
let customGestures = [];
let draftSamples = [];
let currentLandmarks = null;

const MIN_SAMPLES = 3;
const MAX_SAMPLES = 20;
const CUSTOM_GESTURE_DISTANCE_LIMIT = 0.18;

const gestureInfo = {
  Thumb_Up: { name: '엄지 올리기', meaning: '좋아요', emoji: '👍', color: '#dff7e7', textColor: '#237d50' },
  Thumb_Down: { name: '엄지 내리기', meaning: '싫어요', emoji: '👎', color: '#ffe5e9', textColor: '#b44a5b' },
  Closed_Fist: { name: '주먹 쥐기', meaning: '정지', emoji: '✊', color: '#fff1ce', textColor: '#9b751e' },
  Open_Palm: { name: '손바닥 펼치기', meaning: '안녕하세요', emoji: '✋', color: '#dfedff', textColor: '#3475d8' },
  Victory: { name: '브이', meaning: '승리!', emoji: '✌️', color: '#eee4ff', textColor: '#7953c4' },
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 3800);
}

function addHistory(gesture) {
  const empty = historyList.querySelector('.empty-history');
  if (empty) empty.remove();
  const item = document.createElement('div');
  item.className = 'history-item';
  const bubble = document.createElement('div');
  bubble.className = 'history-bubble';
  bubble.style.background = gesture.color;
  bubble.style.color = gesture.textColor;
  bubble.textContent = gesture.emoji;
  const copy = document.createElement('div');
  copy.className = 'history-copy';
  const name = document.createElement('strong');
  name.textContent = gesture.name;
  const meaning = document.createElement('span');
  meaning.textContent = `“${gesture.meaning}”`;
  copy.append(name, meaning);
  const time = document.createElement('span');
  time.className = 'history-time';
  time.textContent = '방금 전';
  item.append(bubble, copy, time);
  historyList.prepend(item);
  while (historyList.children.length > 5) historyList.lastElementChild.remove();
}

function showNoGesture(message = '손동작을 카메라 안에 보여 주세요.') {
  resultEmoji.textContent = '✋';
  resultText.textContent = '아직 인식된 손동작이 없습니다.';
  resultHint.textContent = message;
  confidenceBar.style.width = '0%';
  confidenceText.textContent = '';
  lastGestureKey = '';
}

function showGesture(key, score) {
  const gesture = gestureInfo[key] ?? customGestures.find((item) => item.id === key);
  if (!gesture) return;
  resultEmoji.textContent = gesture.emoji;
  resultText.textContent = `${gesture.name} · “${gesture.meaning}”`;
  resultHint.textContent = '손동작이 인식되었습니다.';
  const percent = Math.round(score * 100);
  confidenceBar.style.width = `${percent}%`;
  confidenceText.textContent = `인식 신뢰도 ${percent}%`;

  const now = Date.now();
  // 같은 손동작으로 기록이 너무 빠르게 반복되지 않도록 제한
  if (key !== lastGestureKey || now - lastHistoryAt > 1800) {
    addHistory(gesture);
    lastHistoryAt = now;
  }
  lastGestureKey = key;
}

function normalizeLandmarks(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return null;
  const wrist = landmarks[0];
  const points = landmarks.map(({ x, y, z }) => [x - wrist.x, y - wrist.y, z - wrist.z]);
  const scale = Math.sqrt(Math.max(...points.map(([x, y, z]) => x * x + y * y + z * z)));
  if (!Number.isFinite(scale) || scale < 0.0001) return null;
  return points.flatMap(([x, y, z]) => [x / scale, y / scale, z / scale]);
}

function nearestCustomGesture(vector) {
  let match = null;
  let bestDistance = CUSTOM_GESTURE_DISTANCE_LIMIT;
  for (const gesture of customGestures) {
    for (const sample of gesture.samples) {
      if (sample.length !== vector.length) continue;
      let squaredDistance = 0;
      for (let index = 0; index < vector.length; index += 1) {
        const difference = vector[index] - sample[index];
        squaredDistance += difference * difference;
      }
      const distance = Math.sqrt(squaredDistance / vector.length);
      if (distance < bestDistance) {
        bestDistance = distance;
        match = gesture;
      }
    }
  }
  return match ? { gesture: match, score: Math.max(0, 1 - bestDistance / CUSTOM_GESTURE_DISTANCE_LIMIT) } : null;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('hand-ai-user-gestures', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('gestures', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB를 열 수 없습니다.'));
  });
}

function getAllGestures() {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('gestures', 'readonly');
    const request = transaction.objectStore('gestures').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('저장된 손동작을 읽을 수 없습니다.'));
  });
}

function persistGesture(gesture) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('gestures', 'readwrite');
    transaction.objectStore('gestures').put(gesture);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error('손동작을 저장할 수 없습니다.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('손동작 저장이 취소되었습니다.'));
  });
}

function removeGesture(id) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('gestures', 'readwrite');
    transaction.objectStore('gestures').delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error('손동작을 삭제할 수 없습니다.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('손동작 삭제가 취소되었습니다.'));
  });
}

function renderCustomGesture(gesture) {
  const card = document.createElement('article');
  card.className = 'gesture-card gesture-custom';
  const art = document.createElement('div');
  art.className = 'gesture-art';
  art.textContent = gesture.emoji;
  const info = document.createElement('div');
  info.className = 'gesture-info';
  const name = document.createElement('h3');
  name.textContent = gesture.name;
  const meaning = document.createElement('p');
  meaning.textContent = `“${gesture.meaning}”`;
  const removeButton = document.createElement('button');
  removeButton.className = 'remove-gesture';
  removeButton.type = 'button';
  removeButton.textContent = '삭제';
  removeButton.setAttribute('aria-label', `${gesture.name} 손동작 삭제`);
  removeButton.addEventListener('click', async () => {
    try {
      await removeGesture(gesture.id);
      customGestures = customGestures.filter((item) => item.id !== gesture.id);
      card.remove();
      showToast(`“${gesture.name}” 손동작을 삭제했습니다.`);
    } catch (error) {
      console.error('Gesture delete error:', error);
      showToast('손동작을 삭제하지 못했습니다.');
    }
  });
  info.append(name, meaning);
  card.append(art, info, removeButton);
  gestureGrid.append(card);
}

function updateSampleControls() {
  captureSampleButton.disabled = !cameraStream || !currentLandmarks || draftSamples.length >= MAX_SAMPLES;
  saveGestureButton.disabled = draftSamples.length < MIN_SAMPLES
    || !gestureNameInput.value.trim()
    || !gestureMeaningInput.value.trim();
  sampleCount.textContent = `샘플 ${draftSamples.length}개 · ${draftSamples.length < MIN_SAMPLES ? `최소 ${MIN_SAMPLES}개 필요` : '저장할 수 있어요'}`;
}

async function initializeCustomGestures() {
  try {
    database = await openDatabase();
    customGestures = await getAllGestures();
    customGestures.forEach(renderCustomGesture);
    datasetStatus.textContent = `이 브라우저에 사용자 손동작 ${customGestures.length}개 저장됨`;
  } catch (error) {
    console.error('Gesture storage error:', error);
    datasetStatus.textContent = '브라우저 저장소를 사용할 수 없습니다. 개인정보 보호 설정을 확인해 주세요.';
    toggleGestureFormButton.disabled = true;
    exportDatasetButton.disabled = true;
    showToast('손동작 저장소를 사용할 수 없습니다.');
  }
}

async function loadRecognizer() {
  if (recognizer) return recognizer;
  if (loadingModel) {
    showToast('AI 모델을 준비하고 있어요. 잠시 기다려 주세요.');
    return null;
  }
  loadingModel = true;
  resultHint.textContent = 'AI 손동작 인식 모델을 다운로드하고 준비하는 중입니다.';
  try {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    recognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
      },
      runningMode: 'VIDEO',
      numHands: 1,
    });
    return recognizer;
  } catch (error) {
    console.error('MediaPipe model load error:', error);
    showToast('AI 모델을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
    resultHint.textContent = 'AI 모델 로딩에 실패했습니다. 인터넷 연결을 확인하세요.';
    throw error;
  } finally {
    loadingModel = false;
  }
}

function recognizeFrame() {
  if (!cameraStream || video.readyState < 2 || !recognizer) {
    if (cameraStream) animationFrame = requestAnimationFrame(recognizeFrame);
    return;
  }
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try {
      const result = recognizer.recognizeForVideo(video, performance.now());
      currentLandmarks = normalizeLandmarks(result.landmarks?.[0]);
      updateSampleControls();
      const customMatch = currentLandmarks ? nearestCustomGesture(currentLandmarks) : null;
      const topGesture = result.gestures?.[0]?.[0];
      if (customMatch) {
        showGesture(customMatch.gesture.id, customMatch.score);
      } else if (topGesture && topGesture.categoryName !== 'None' && topGesture.score >= 0.55 && gestureInfo[topGesture.categoryName]) {
        showGesture(topGesture.categoryName, topGesture.score);
      } else {
        showNoGesture();
      }
    } catch (error) {
      console.error('Gesture recognition error:', error);
    }
  }
  animationFrame = requestAnimationFrame(recognizeFrame);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('카메라를 사용할 수 없습니다. localhost 주소로 접속했는지 확인해 주세요.');
    return;
  }
  startButton.disabled = true;
  try {
    const modelPromise = loadRecognizer();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = cameraStream;
    await video.play();
    video.hidden = false;
    placeholder.hidden = true;
    liveLabel.hidden = false;
    stopButton.disabled = false;
    await modelPromise;
    if (!cameraStream) return;
    resultHint.textContent = '손을 카메라에 보여 주세요.';
    showToast('AI 손동작 인식이 시작되었습니다.');
    animationFrame = requestAnimationFrame(recognizeFrame);
  } catch (error) {
    console.error(error);
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    video.srcObject = null;
    currentLandmarks = null;
    video.hidden = true;
    placeholder.hidden = false;
    liveLabel.hidden = true;
    startButton.disabled = false;
    stopButton.disabled = true;
    if (error.name === 'NotAllowedError') {
      showToast('카메라 권한이 차단되었습니다. 브라우저의 사이트 권한을 확인해 주세요.');
    } else if (error.name === 'NotFoundError') {
      showToast('사용 가능한 카메라를 찾을 수 없습니다.');
    } else if (error.message) {
      showToast(error.message);
    } else {
      showToast('카메라 또는 AI 모델을 연결하지 못했습니다.');
    }
  }
}

function stopCamera() {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  video.srcObject = null;
  currentLandmarks = null;
  video.hidden = true;
  placeholder.hidden = false;
  liveLabel.hidden = true;
  startButton.disabled = false;
  stopButton.disabled = true;
  showNoGesture('인식 시작을 눌러 다시 시작하세요.');
  showToast('카메라와 손동작 인식을 중지했습니다.');
  updateSampleControls();
}

toggleGestureFormButton.addEventListener('click', () => {
  gestureForm.hidden = !gestureForm.hidden;
  if (!gestureForm.hidden) gestureNameInput.focus();
});
closeGestureFormButton.addEventListener('click', () => {
  gestureForm.hidden = true;
});
gestureNameInput.addEventListener('input', updateSampleControls);
gestureMeaningInput.addEventListener('input', updateSampleControls);
gestureEmojiInput.addEventListener('input', updateSampleControls);
captureSampleButton.addEventListener('click', () => {
  if (!currentLandmarks || draftSamples.length >= MAX_SAMPLES) return;
  draftSamples.push(currentLandmarks);
  updateSampleControls();
});
gestureForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = gestureNameInput.value.trim();
  const meaning = gestureMeaningInput.value.trim();
  const emoji = gestureEmojiInput.value.trim() || '✨';
  if (!name || !meaning || draftSamples.length < MIN_SAMPLES) return;
  if (customGestures.some((gesture) => gesture.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    showToast('같은 이름의 손동작이 이미 있습니다.');
    gestureNameInput.focus();
    return;
  }
  const gesture = {
    id: `custom-${crypto.randomUUID()}`,
    name,
    meaning,
    emoji,
    color: '#eee8ff',
    textColor: '#7953c4',
    samples: draftSamples,
    createdAt: new Date().toISOString(),
  };
  saveGestureButton.disabled = true;
  try {
    await persistGesture(gesture);
    customGestures.push(gesture);
    renderCustomGesture(gesture);
    datasetStatus.textContent = `이 브라우저에 사용자 손동작 ${customGestures.length}개 저장됨`;
    gestureForm.reset();
    gestureEmojiInput.value = '✨';
    draftSamples = [];
    updateSampleControls();
    gestureForm.hidden = true;
    showToast(`“${name}” 손동작과 샘플 ${gesture.samples.length}개를 저장했습니다.`);
  } catch (error) {
    console.error('Gesture save error:', error);
    saveGestureButton.disabled = false;
    showToast('손동작을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.');
  }
});
exportDatasetButton.addEventListener('click', async () => {
  try {
    const data = {
      format: 'hand-ai-gesture-dataset',
      version: 1,
      exportedAt: new Date().toISOString(),
      gestures: await getAllGestures(),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `hand-ai-gestures-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('학습 데이터 JSON 백업을 다운로드했습니다.');
  } catch (error) {
    console.error('Gesture export error:', error);
    showToast('학습 데이터를 내보내지 못했습니다.');
  }
});

startButton.addEventListener('click', startCamera);
stopButton.addEventListener('click', stopCamera);
initializeCustomGestures();
window.addEventListener('beforeunload', () => {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  cameraStream?.getTracks().forEach((track) => track.stop());
  recognizer?.close();
});
