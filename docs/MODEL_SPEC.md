# SignBridge AI 공통 모델·데이터 계약

## 버전 및 범위

- `schema_version: "1.0.0"`
- `preprocessing_version: "wrist-scale-spatial-v1"`
- 인식·수집 기본 단위: 개별 수어 단어 한 번의 연속 동작. 정적 표현도 여러 프레임의 시퀀스로 보존.
- KSL/ASL은 독립된 라벨 공간을 사용. TensorFlow.js 학습·단어 예측과 검증 자료 기반 대응 조회를 구현. 실제 수어로 학습·검증한 공개 모델과 문장 번역은 아직 제공하지 않음.
- 초기 단어 AI는 **손동작만으로 구별 가능한 사전 선정된 제한 어휘**를 대상으로 설계. 얼굴 표정·입 모양·머리·상체 움직임은 현재 수집·인식 대상에서 제외. 모든 수어 단어를 손만으로 구별한다고 가정하지 않음.
- MediaPipe `@mediapipe/tasks-vision@1.1.1`, Hand Landmarker `float16/1`. 모델 해시는 `public/models/manifest.json` 참조.

## 데이터셋 봉투

```json
{
  "schema_version": "1.0.0",
  "exported_at": "2026-10-24T00:00:00.000Z",
  "signs": [],
  "samples": []
}
```

`exported_at`은 다운로드 때만 추가하는 정보이며 검증 필수 항목이 아닙니다. `signs`는 다음 필드를 갖습니다.

| 필드 | 의미 |
|---|---|
| sign_id | 전역 고유 표현 ID. 기본 언어 접두사+UUID; 동일 단어의 변이도 별도 ID |
| language | `KSL` 또는 `ASL` |
| label | 해당 언어 표현의 관리용 단어 이름 |
| concept_id | 사람이 관리하는 언어 독립 의미 코드 |
| description | 의미·방언·표현 변이·주의점. 빈 문자열 허용 |
| source | 검증 자료 URL 또는 서지 정보. 빈 문자열 허용 |
| correspondence_verified | 담당자가 의미 대응 관계를 검증했는지. true에는 source 필수 |

`concept_id` 예시 형식은 `concept.<domain>.<sense>`이며 기계가 번역·동의어를 자동 판정하지 않습니다. 다의어는 의미별 코드를 분리합니다. 같은 코드를 공유해도 문법·사용 맥락·표현 방식이 같다는 뜻은 아닙니다. 현재 스키마의 검증 표시는 담당자의 주장과 자료 출처를 기록하는 기본 메타데이터이며, 이후 대응 표현별 링크·검증자·검증 일자·지역 변이를 다루는 별도 대응 테이블로 확장할 수 있습니다. 검증된 대응 영상이 없다면 임의 생성해 제공하지 않습니다.

## 단어 샘플

| 필드 | 타입 / 규칙 |
|---|---|
| schema_version | 정확히 `1.0.0` |
| sample_id | UUID 기반 전역 고유 ID |
| language / sign_id / concept_id / label | 등록 단어 메타데이터의 스냅샷; signs와 일치해야 함 |
| signer_id | 익명 촬영자 ID; 최대 500자. UI 최대 100자 |
| session_id | 촬영 세션 ID; 한 세션에는 한 촬영자만 허용 |
| start_timestamp / end_timestamp | UTC ISO 시각 |
| duration_ms | 실측 녹화 시간(ms), 양수, 시각 차이와 오차 2ms 이내 |
| sequence_length | frames 배열 길이와 일치, 1~7200 |
| frames | 아래 규격의 관측 프레임 배열 |
| capture | width, height(양수), mirrored_input:false |
| preprocessing_version | 향후 특징 생성에 사용할 버전; 원본 좌표가 전처리되었다는 뜻 아님 |

녹화 시작 순간의 `Date.now()`와 단조 증가 `performance.now()`를 함께 고정하고 이후 시각은 단조 시계의 경과로 계산합니다. 녹화 중 OS 시계가 바뀌어도 프레임 순서는 영향을 받지 않습니다. 종료 시각은 같은 기준점+실측 경과입니다. 카운트다운은 샘플에 포함하지 않습니다. 고정 길이로 자르거나 프레임을 복제하지 않습니다. 메모리 보호용 최대 120초(수동 포함)이며 표현을 도중에 자르지 않도록 사용자가 종료 시간을 정해야 합니다.

## 프레임과 관절

```js
{
  timestamp: 1792800000123.5,       // epoch ms, 소수 허용
  relative_timestamp: 123.5,      // 녹화 시작 이후 ms
  detected_hand_count: 1,
  hands: [{
    handedness: 'Left',           // Left | Right | Unknown
    score: 0.96,                 // handedness 분류 신뢰도 (관절 검출 확률 아님)
    landmarks: [/* 21 × {x,y,z} */]
  }]
}
```

`landmarks`와 `handedness`는 **프레임의 hands 각 항목에** 저장합니다. 프레임 최상위에 중복 복사하지 않습니다. 미감지 프레임은 `detected_hand_count:0, hands:[]`이며 임의 좌표·이전 좌표를 저장하지 않습니다. 프레임 시간은 엄격히 증가하고 0~duration_ms 안에 있어야 합니다. 좌우는 MediaPipe 결과를 그대로 기록하며 배열 인덱스로 손을 식별하지 않습니다. 순간적인 좌우 오판은 재생과 품질 경고로 검토해야 합니다.

원본 영상은 반전하지 않고 모델에 전달하며 미리보기와 재생 캔버스만 거울 모드입니다. 데이터 담당자는 실제 왼손·오른손을 움직여 카메라 드라이버와 모델의 좌우 결과가 기대와 일치하는지 수집 전 검증해야 합니다. 자체적으로 영상을 반전하는 가상 카메라는 주의하세요.

좌표는 MediaPipe 이미지 좌표입니다. x/y는 영상 너비/높이에 대한 정규화 좌표로 화면 경계 밖으로 벗어나는 값은 보존합니다. z는 **각 손목을 기준으로 한 상대 깊이**이며 전역 깊이·양손 간 실제 거리로 해석하면 안 됩니다. 원본 좌표를 clamp하거나 필터링하지 않습니다. world landmarks는 현재 저장하지 않습니다.

관절 순서는 MediaPipe 표준 순서를 유지합니다.

| 인덱스 | 관절 |
|---|---|
| 0 | 손목 |
| 1~4 | 엄지 CMC, MCP, IP, 끝 |
| 5~8 | 검지 MCP, PIP, DIP, 끝 |
| 9~12 | 중지 MCP, PIP, DIP, 끝 |
| 13~16 | 약지 MCP, PIP, DIP, 끝 |
| 17~20 | 소지 MCP, PIP, DIP, 끝 |

`detectForVideo(video, timestampMs)`는 VIDEO 모드에서만 실행합니다. `video.currentTime`이 이전 처리 프레임과 같으면 건너뛰며, MediaPipe에 전달하는 타임스탬프도 엄격히 증가시킵니다. 화면 FPS는 실제 검출 처리 프레임 수입니다. 현재 동기 추론을 메인 스레드에서 실행하므로 낮은 성능 환경에서 UI·FPS가 느려질 수 있습니다. Worker 도입은 후속 최적화이며 이미 구현했다고 간주하지 않습니다. 카메라·브라우저가 전달하지 않은 프레임이나 처리 중 놓친 프레임을 0손 관측으로 조작하지 않습니다. **처리한 프레임에서 검출되지 않은 경우만** 0손 프레임입니다.

## 공통 전처리

`preprocessSequence(sample)`은 원본을 변경하지 않고 별도 결과를 반환합니다. 언어에 따른 분기는 없습니다.

1. 프레임 순서와 원본 상대 타임스탬프 유지. 리샘플링·패딩·보간 안 함.
2. 고정 슬롯 순서: Left → Right. 손 검출 배열의 반환 순서와 무관.
3. 손목(0) 기준 상대 xyz 계산. y 차이에 `height/width`를 곱해 너비 기준 단위로 보정. z는 이미 x와 비슷한 스케일.
4. 손목에서 가장 먼 관절까지의 3차원 거리로 손별 scale을 정하고 상대 좌표를 나눔. 회전·방향은 정규화하지 않음.
5. 절대 이미지 손목 x/y, 손 크기 scale, 좌우, handedness score를 별도로 유지. 양손의 상대 손목 x/y도 별도 유지. 원본 데이터와 함께 위치·방향·상대 크기 특징을 사용 가능.
6. 한 손이 누락되거나 동일 좌우로 두 손이 분류되면 해당 슬롯의 presence=0. Unknown은 고정 슬롯에 임의 할당하지 않고 개수로 보고. 퇴화 scale(<1e-8)도 별도 표시.
7. 0 패딩은 **파생 특징 슬롯에만**, presence 마스크와 함께 사용. 원본 hands 배열을 채우지 않음. 양손의 전역 깊이는 측정할 수 없어 cross-hand z를 만들지 않음.

`feature_size = 137`:

```text
Left:  presence(1), wrist_x/y(2), scale(1), normalized xyz(63) = 67
Right: 같은 구조 = 67
pair:  right-left wrist dx, dy*(height/width), pair_presence = 3
```

반환 결과는 `{sample_id, preprocessing_version, feature_size, frames:[{relative_timestamp, hands, relative_wrist_xy, unknown_hand_count, features}]}`. 신뢰도는 hands 메타데이터에 있으며 137차원 벡터에는 들어가지 않습니다. 모델 입력 변환은 이 특징과 존재 마스크·원본 시간을 함께 사용합니다. 절대 손목·방향·양손 상대 위치를 보존합니다.

## 저장·검증·분할

- 등록, 저장, 가져오기에서 동일 검증 함수를 사용. 버전, 유한한 21개 xyz, 손 수, 시간 순서, 종료 범위, 참조 무결성 검증.
- sample_id와 sign_id로 중복 확인. JSON 객체 속성 순서는 무시하고 값은 같아야 중복으로 판정. 같은 ID에 다른 내용은 병합 전체 중단. 다른 ID를 부여한 동일 동작의 의미적 중복은 자동 판별하지 못함.
- IndexedDB signs/samples 읽기·검증·쓰기 한 트랜잭션으로 처리. 다른 탭의 병합을 덮어쓰지 않음. 삭제는 트랜잭션 완료 후 UI 반영.
- 품질 지표: 미감지 수/비율, 양손 감지 프레임 수, 유효성. 미감지 비율 >30%, <10프레임, <0.5초, 좌우 불확실 시 경고. 품질 경고와 형식 오류를 구분. 자동 점수는 언어학적 정확성을 판정하지 않음.
- `splitByGroup(samples, {by:'signer_id', testRatio:0.2})`: 촬영자 그룹을 통째로 보류. 대안 `by:'session_id'`. 정렬된 그룹 기반의 재현 가능한 초기 분할이며 무작위·계층화 분할은 아님. 그룹 1개면 테스트가 없다는 경고. 하나의 세션이 양쪽에 걸리면 오류.
- 실제 평가 전에는 언어·단어별 클래스 균형을 점검하고 **서로 다른 촬영자**를 테스트에 배정할 것. 동작 시퀀스를 프레임 단위로 쪼개 무작위 분할하지 말 것.

## 구현된 KSL/ASL 학습·예측 인터페이스

```js
const prepared = prepareTraining(dataset, 'KSL', selectedSignIds);
const result = await trainer.train(prepared, {language:'KSL', allSigns:dataset.signs, epochs:30});
const prediction = await predictSequence(result.model, result.metadata, sample);
// → {unknown, top: null | classWithConfidence, candidates, model_version}
```

`src/ai/sequenceInput.js`는 공통 특징을 실제 시간 기준 32개 위치에서 최근접 관측으로 선택합니다. 관측과 목표 시각 차이가 200ms를 넘으면 해당 파생 특징 슬롯은 0으로 두며 원본을 보간하지 않습니다. 각 시간 단계에 `min(duration_ms/10000,12)`를 추가해 움직임 길이를 유지합니다. 입력은 **32×138**, input_version은 `nearest-time-32-duration-v1`입니다. 원본 스키마와 전처리 버전은 바꾸지 않습니다.

기본 구조는 Conv1D(24, kernel3, same, relu) → Conv1D(24, kernel3, stride2, relu) → Flatten → Dense32/relu → Dropout0.2 → Dense N/softmax입니다. Adam 0.001, categoricalCrossentropy, batch≤16, Epoch 1~200입니다. TensorFlow.js를 지연 로드하며 별도 추론 서버는 없습니다.

학습에서 미감지 >30%, 10프레임 미만, 0.5초 미만은 제외합니다. 2클래스 이상, 클래스당 학습≥2·검증≥1이 필요합니다. 촬영자 그룹 보류를 우선하고 불가능하면 세션 그룹으로 분리합니다. 이 최소량은 성능 보장 기준이 아닙니다. 검증 자료를 Epoch마다 참고하므로 최종 성능에는 별도 미참여 촬영자 테스트가 필요합니다. 브라우저 한도는 2000 유효 샘플·100클래스입니다.

metadata.json은 format_version=1.0.0, model_version, language, schema/preprocessing/input 버전, time_steps=32, feature_size=138, 순서 있는 classes, split_by, 샘플 수·검증 지표, confidence_threshold=0.75, margin_threshold=0.15를 포함합니다. 각 클래스에 gloss_ko/gloss_en와 검증한 대응 항목을 보존합니다. 표기는 자동 번역하지 않습니다. 대응은 양쪽 검증 표시·같은 concept_id·출처가 있어야 합니다.

예측은 위 신뢰도와 상위 두 후보 차이를 만족할 때만 top을 확정합니다. 부족하면 unknown=true, top=null로 두고 실제 상위 후보를 표시합니다. 출력이 0~1 확률이고 합이 1에 가까운지도 검사합니다. 초기 임계값은 실측 보정 전 기준이며 미등록 동작 거절을 보장하지 않습니다. KSL/ASL은 별도 모델과 클래스 목록으로 저장합니다. 배포 파일·언어·입력 형상·전처리·model_version을 확인하고 모델이 없으면 예측하지 않습니다.

Supabase는 원본을 한 행으로 보존하며 `sequence_length→frame_count`, `sample_id→id`로 매핑합니다. capture·시작/종료 시각·sign_metadata도 저장해 JSON으로 복원합니다. DB 상세는 DATABASE_SETUP, 모델 배포는 MODEL_DEPLOYMENT를 참고하세요.

문장 확장은 단어 추론 모듈 밖에 연속 구간 분리, 비수지 신호(얼굴·상체), 언어별 문법·맥락 해석을 추가합니다. 필드 추가 시 하위 호환 정책과 버전을 정의하고 마이그레이션 없이 현재 v1 검증기를 우회하지 않습니다. 단어 문자열의 결합만으로 완전한 수어 문장 번역을 구현하지 않습니다.

## Face·Pose 확장을 위한 모듈 경계

현재 카메라 취득(`camera/`), 손 추적(`mediapipe/handTracker.js`), 시퀀스 수집(`collector/`), 원본 검증·특징 변환(`shared/`)은 분리되어 있습니다. 녹화기는 MediaPipe 결과 객체를 직접 참조하지 않고 시간과 일반 좌표 객체를 받습니다. 향후 Face Landmarker·Pose Landmarker는 손 추적기를 수정해 합치는 대신 별도 추적 어댑터로 추가합니다.

추가 채널은 동일한 원본 영상 프레임 및 단조 시계에 맞춰 `face`/`pose` 등의 이름 공간, 감지 여부, 좌표계·관절 순서·모델 버전을 명시하는 다음 스키마 버전으로 정의해야 합니다. 채널마다 독립 전처리 버전을 사용하고 손의 기존 `hands` 및 절대·상대 위치를 유지합니다. 얼굴·자세 결측값을 손 좌표로 채우거나 현재 손만 포함한 v1 데이터를 다중 신호 데이터라고 표시하지 않습니다. 이 절은 확장 설계이며 Face·Pose 실행·수집 기능은 이번 구현에 추가하지 않습니다.
