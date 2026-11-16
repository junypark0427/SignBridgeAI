# SignBridge AI 상세 개발 로그

작성·조회 기준: **2026-11-17, Asia/Seoul**. 분석 대상은 공개 Git 이력 전체와 GitHub API로 확인한 Actions·PR, 기본 브랜치의 코드·문서다. 기능 기준 커밋은 [`c5f237f`](https://github.com/junypark0427/SignBridgeAI/commit/c5f237f)이다. 이 문서에서 날짜는 Git의 작성자 시각을 한국 표준시로 표시하며 실제 최초 구상·코딩 시작일을 뜻하지 않는다. Actions의 UTC 시각도 한국 시간으로 변환했다.

**증거의 한계:** 커밋의 코드 존재는 실제 사용자 환경에서의 완전한 동작을 뜻하지 않는다. 아래의 과거 브라우저·서버 실험은 당시 작성된 [`docs/VALIDATION.md`](../docs/VALIDATION.md)의 기록을 인용한 것이며, 이번 분석에서 그 실험을 재현한 것은 아니다. 팀원별 구체적인 역할, 기록에 없는 오류·회의·구현 시작일은 확인할 수 없다.

## 1. 브랜치와 협업 이력

2026-11-17 공개 GitHub 조회 기준 기본 브랜치는 **`feature/data-collector`**다. 원격 브랜치는 다음 네 개이며 `main`은 조회되지 않았다. 따라서 아래의 ‘현재 구현’은 `main` 통합이 아니라 기본 기능 브랜치 기준이다. `main`이 과거에 존재했는지나 삭제된 이유는 확인할 수 없다.

| 브랜치 | 확인된 최신 커밋 | 역할 및 상태 |
| --- | --- | --- |
| `feature/data-collector` | [`c5f237f`](https://github.com/junypark0427/SignBridgeAI/commit/c5f237f) | 수집·공유·DTW·문장 실험·음성 듣기를 포함하는 기본 개발 브랜치 |
| `design` | [`ac5e8df`](https://github.com/junypark0427/SignBridgeAI/commit/ac5e8df) | `Hand_AI - 복사본` 디자인 및 별도 구현. 이 커밋 자체는 기능 브랜치의 조상이 아니다. 동일 폴더는 별도 커밋 `4aae734`로 기능 브랜치에 존재하며 UI 일부 참고 기록이 있다. |
| `Cross-translate` | [`65288f8`](https://github.com/junypark0427/SignBridgeAI/commit/65288f8) | 별도 `ksl_asl_translator`와 단일 HTML 예제. 한 손 규칙 기반 데모 및 Web Speech 음성이 이 브랜치에 있다. 이 커밋은 기능 브랜치의 조상이 아니다. |
| `KR-EG-crossing` | [`79c0495`](https://github.com/junypark0427/SignBridgeAI/commit/79c0495) | 해당 시점까지 기능 브랜치와 동일한 커밋을 가리킨다. 별도 신규 커밋이나 이후 기능 통합은 확인되지 않는다. |

공개 PR API의 전체 상태 조회 결과 **PR 0건**, 접근 가능한 전체 Git 이력의 **병합 커밋 0건**이다. 따라서 PR 리뷰·충돌·병합 시각은 확인할 기록이 없다. `design`과 `Cross-translate`의 커밋이 기능 브랜치에 병합됐다고 말할 수 없다. 다만 공통 조상이나 같은 내용의 파일이 존재하는 것과 병합은 별개다.

## 2. 날짜별 개발 과정

### 2026-10-24 — 브라우저 데이터 수집기 초기 구성

- **목표:** KSL/ASL 단어 하나의 동작을 정적 이미지가 아닌 시간순 시퀀스로 수집한다.
- **구현:** 확인 가능한 최초이자 루트 커밋 [`312a6d8`](https://github.com/junypark0427/SignBridgeAI/commit/312a6d8)은 Vite 기반 화면, 카메라 관리, MediaPipe Hand Landmarker, 좌우 손 관절 시각화, 프레임 시간·빈 손 프레임, `concept_id`·촬영자·세션 정보, IndexedDB와 JSON, 스키마·공통 전처리 및 CI를 한꺼번에 추가했다. 빈 프로젝트 생성 커밋이나 별도 초기 화면 작업 시점은 Git에서 확인되지 않는다.
- **문제와 대응:** 카메라 거부·장치 부재, 동일 영상 프레임 중복, 미검출 데이터와 시퀀스 유효성 검사가 필요한 경우에 대비한 코드와 테스트를 포함했다. 초기 `handTracker.js`에 GPU 초기화 실패 시 CPU 대체 경로가 이미 존재한다. 실제 GPU 미지원 기기에서의 CPU 실행은 당시 기록상 미검증이다.
- **검증 기록:** 당시 `docs/VALIDATION.md`에 자동화 35개·빌드 성공과 실제 카메라 한 손 46프레임 수집/검토 기록이 있다. 양손 정확도와 실제 수어 단어 분류는 검증되지 않았다. [`5231095`](https://github.com/junypark0427/SignBridgeAI/commit/5231095)는 원격 CI 성공과 MediaPipe의 `OpenGL error checking is disabled`, `NORM_RECT` 경고를 기록한다. 경고가 제거됐다는 근거는 없다. [당시 Actions #1](https://github.com/junypark0427/SignBridgeAI/actions/runs/40055685864)

### 2026-10-24 — 공용 저장소와 고급 신경망 학습 실험

- **구현:** [`c438fd6`](https://github.com/junypark0427/SignBridgeAI/commit/c438fd6)은 Supabase SDK·`sign_samples` SQL·RLS·익명 SELECT/INSERT, `sampleRepository`·`syncManager`, 팀 공용 데이터 조회, 오프라인 IndexedDB 보존과 재시도, 페이지 조회, Netlify 설정을 추가했다. 동시에 TensorFlow.js 시퀀스 입력·학습·모델 저장/불러오기 화면과 코드가 추가되었다.
- **문제와 대응:** 클라우드 저장 실패가 로컬 원본 유실로 이어지지 않도록 로컬 먼저 저장하고 서버 응답·UUID 충돌을 확인하는 구조를 사용했다. API 테스트는 테스트 행과 필터·중복·권한 제한을 구분했다.
- **검증 기록:** 당시 문서는 자동화 47개, 빌드, 실제 Supabase 테스트 행 INSERT/SELECT, 합성 데이터의 브라우저 2 Epoch 학습·모델 저장/불러오기 성공을 기술한다. 실제 수어 모델 정확도나 공개 모델 완성의 증거는 아니다. [Actions #3](https://github.com/junypark0427/SignBridgeAI/actions/runs/40086870736)

### 2026-10-24 — 팀원 디자인과 공용 데이터 표시 개선

- [`4aae734`](https://github.com/junypark0427/SignBridgeAI/commit/4aae734)은 기능 브랜치에 팀원 `Hand_AI - 복사본` 파일을 추가했고, 별도로 [`ac5e8df`](https://github.com/junypark0427/SignBridgeAI/commit/ac5e8df)가 `design` 브랜치에 올라왔다. 이후 [`68712d9`](https://github.com/junypark0427/SignBridgeAI/commit/68712d9)는 카드·통계·버튼 스타일을 참고하면서 기존 화면에 적용했다. 두 커밋 사이에 브랜치 병합 기록은 없다.
- **실제 문제:** 공용 목록의 언어 필터가 촬영 설정의 언어 라디오와 충돌하여 표시가 어긋났고, 이 기기의 0개와 공용 자료의 존재가 혼동될 수 있었다. `src/main.js`의 라디오 선택 범위를 제한하고 `cloudStatus.js`, `datasetUI.js`에 로컬·대기·업로드 확인·공용 목록 안내와 갱신을 추가했다.
- **검증 기록:** 당시 문서에 ASL 공용 필터 사용 중 KSL 촬영 선택 유지, 공용 목록 표시와 54개 자동화·빌드 성공이 기록되어 있다. 팀원 기기의 원래 업로드 증상과 이 오류가 같은 원인인지는 확인되지 않았다. [Actions #5](https://github.com/junypark0427/SignBridgeAI/actions/runs/40098116262)

### 2026-10-31 — 소량 데이터 즉시 인식, 품질 관리, 실제 삭제

- **목표와 변경:** [`b246391`](https://github.com/junypark0427/SignBridgeAI/commit/b246391)은 기본 Try AI를 별도 수동 모델 학습 없이 공용 시퀀스를 비교하는 DTW로 전환했다. 1단어 1샘플도 비교 가능하게 하고 데이터 부족·불확실 경고, KSL/ASL 분리, 최신 공용 조회, 검토·실제 삭제, UUID 삭제 기록과 재업로드 방지 기능을 추가했다. TensorFlow.js 학습 코드는 고급 화면에 남겼다.
- **데이터 품질 문제:** 녹화 앞뒤의 손 미검출이 정상 동작을 가릴 수 있어 `trainingQuality.js`에서 첫·마지막 유효 손 검출 사이를 파생 사본으로 트림한다. 내부 누락·양손 부족은 별도 계수하며, 트림 후 30% 초과는 경고이지 전체 구간 비율만으로 무조건 제외하는 규칙이 아니다. 실제 손 좌표가 없거나 형식이 잘못된 자료는 제외한다. 고급 학습에는 짧은 결측의 선택적 보정이 있고, 기본 DTW는 보간하지 않는다.
- **권한·안전:** 해당 시점 SQL은 이전 휴지통 정책과 실제 샘플 삭제 정책을 추가했다. 익명 삭제에는 사용자 확인과 UUID 기준 삭제 확인이 필요하며 재업로드 방지 기록을 둔다. 인증 없는 공용 사이트 방문자도 허용된 삭제를 할 수 있는 한계가 있다.
- **검증 기록:** 당시 문서의 자동화 74개, 합성 1/2클래스 DTW·트림·삭제 검사와 테스트 샘플을 이용한 실제 API 검증을 확인했다. 실제 사용자의 새로운 수어 정확도 검증은 아니었다. [`f4bc2e4`](https://github.com/junypark0427/SignBridgeAI/commit/f4bc2e4)는 해당 코드의 [Netlify Published 기록](https://app.netlify.com/projects/signbridgeai1/deploys/6ae556cc3320d888824a0087)을 남겼다. [Actions #6](https://github.com/junypark0427/SignBridgeAI/actions/runs/41161568867)
- **화면 전환 문제:** [`5e6e1ea`](https://github.com/junypark0427/SignBridgeAI/commit/5e6e1ea)는 비교 도중 탭 숨김·화면 이동 시 `predicting`이 남지 않도록 정리하고 회귀 검사를 추가했다. [Actions #7](https://github.com/junypark0427/SignBridgeAI/actions/runs/41161756702)

### 2026-11-01 — 문장 규칙과 조회·버튼 개선

- [`1e574cf`](https://github.com/junypark0427/SignBridgeAI/commit/1e574cf)는 Try AI의 단어/문장 모드, 단어 누적·수정·삭제·순서 변경, 제한된 KSL 의미 사전과 규칙 기반 한국어 구절 생성을 추가했다. `사랑 + 배우다 → 사랑을 배우다`는 하나의 예이며, 서술어 자릿수·의미 범주·등록된 성분 순서와 조사 규칙을 확인한다. [Actions #8](https://github.com/junypark0427/SignBridgeAI/actions/runs/41215055131)
- **조회 지연:** 당시 기록에는 큰 시퀀스 25개 일괄 조회의 DB 시간 초과와 약 18초 대기가 나온다. [`db58ba1`](https://github.com/junypark0427/SignBridgeAI/commit/db58ba1)은 작은 메타데이터 목록을 먼저 읽고 시퀀스는 최대 3개씩 병렬 조회하며 조회 전후 ID를 확인했다. 기록상 같은 환경의 41개 조회 약 18→12초는 환경 의존적 관측값이다. [Actions #9](https://github.com/junypark0427/SignBridgeAI/actions/runs/41215677503)
- **검증 범위:** 기록에 `사랑`과 `배우다` 각각 7개 자료의 자기 샘플 제외 비교가 7/7로 나오지만 같은 촬영자·세션이 겹칠 수 있으므로 독립 사용자 정확도가 아니다. 실제 카메라로 두 단어를 수행해 구절을 완성한 시험은 미검증이다.
- **시작·종료 버튼 문제:** [`93f9ad6`](https://github.com/junypark0427/SignBridgeAI/commit/93f9ad6)은 시작 전 네트워크 재조회로 녹화가 늦어지고 종료 후 상태 갱신이 늦던 흐름을 수정했다. 준비된 자료로 즉시 시작하고 종료 후 최신 데이터를 확인하며, 대기 이유와 10초 자동 종료를 표시한다. 당시 카메라 시작/종료는 확인했으나 수어 동작 정확도는 검증하지 않았다. [Actions #10](https://github.com/junypark0427/SignBridgeAI/actions/runs/41216526432)

### 2026-11-14 — 공용 메타데이터 편집과 단어별 그룹

- [`df3c7a3`](https://github.com/junypark0427/SignBridgeAI/commit/df3c7a3)은 편집 UI와 제한된 DB 함수·마이그레이션을 추가했다. 단어 정보는 같은 표현 ID의 샘플에 함께 적용하고, 촬영자·세션은 선택 샘플에 적용한다. 원본 프레임과 언어는 수정 대상이 아니다. 변경 전 값·대상 수를 확인하고 충돌을 거부하며 의미 코드 변경 시 대응 검증을 해제한다. 오래된 표현 정보의 충돌 업로드도 차단한다. 로그인 없이 방문자가 허용된 메타데이터를 바꿀 수 있으므로 JSON 백업이 중요하다. 코드와 자동화 검사는 확인되나, 해당 커밋 자체만으로 실 DB 적용·실제 수정 성공 시점을 독립 증명할 수는 없다. [Actions #11](https://github.com/junypark0427/SignBridgeAI/actions/runs/43544991012)
- [`79c0495`](https://github.com/junypark0427/SignBridgeAI/commit/79c0495)는 언어와 `sign_id`를 기준으로 샘플을 접기/펼치기 그룹으로 묶고 각 항목의 검토·수정·삭제를 유지했다. 메타데이터를 커서 방식으로 끝까지 읽고 전후 개수를 점검해 서버 페이지 제한으로 일부만 세는 문제를 막는다. 완전한 DB 스냅샷 잠금은 아니다. [Actions #12](https://github.com/junypark0427/SignBridgeAI/actions/runs/43546414761)
- [`181e7b7`](https://github.com/junypark0427/SignBridgeAI/commit/181e7b7)은 출처·검증 여부와 별개로 같은 `concept_id`의 반대 수어 등록 이름을 표시하도록 했다. 복수 이름과 조회 실패를 다루며, 같은 코드만으로 완전한 언어적 대응을 보장하지 않는다는 안내를 유지했다. [Actions #13](https://github.com/junypark0427/SignBridgeAI/actions/runs/43547381076)
- **팀원 별도 시도:** [`65288f8`](https://github.com/junypark0427/SignBridgeAI/commit/65288f8)의 `Cross-translate`는 MediaPipe Hands 한 손의 손가락 상태·이동 궤적을 고정 사전과 비교하고 Web Speech로 두 이름을 읽는 별도 데모다. 기능 브랜치의 DTW와 서로 다른 코드이며 해당 커밋은 병합되지 않았다. 사전은 검증된 수어 번역의 증거가 아니다.

### 2026-11-14 — 문장 모드의 손 미검출 기반 자동 구분

- [`d028bd4`](https://github.com/junypark0427/SignBridgeAI/commit/d028bd4)는 `handSegmenter.js`를 추가했다. 손이 연속 감지되면 시작하고 양손 중 한 손이라도 감지되면 유지하며, 기본 600ms 연속 미검출을 시간 기준으로 판단한다. 간격은 UI에서 조절 가능하다. 수동 확정 후 재등장 대기, 끝의 빈 프레임 제거, 종료 시 마지막 단어 처리, 순서 보존 분석 대기열을 사용한다.
- **검증 기록:** 합성 프레임으로 짧은 누락·양손 가림·중복 방지·마지막 구간·분석 순서와 `사랑 → 배우다 → 사랑을 배우다`를 검사했다. 당시 문서는 카메라 준비 완료와 실제 두 수어 연속 인식은 미검증으로 구분한다. 자연스러운 연속 수어의 일반적인 경계 검출이나 완전한 문장 번역이 아니다. [Actions #14](https://github.com/junypark0427/SignBridgeAI/actions/runs/43549274388)

### 2026-11-15 — 한국어·영어 듣기

- [`c5f237f`](https://github.com/junypark0427/SignBridgeAI/commit/c5f237f)는 기본 Try AI의 이름 결과에 Web Speech API 기반 한국어/영어 개별 듣기와 중지 버튼을 추가했다. 같은 코드에 이름이 여러 개면 선택하며, 없거나 조회 실패한 상대 언어는 읽지 않는다. 화면 이동·결과 교체 시 재생을 정리한다.
- **검증 범위:** `tests/speech-player.test.js`와 `tests/corresponding-names.test.js`는 모의 음성 API로 언어·텍스트 선택, 중지, 미지원, 오류와 조회 실패 처리를 검사한다. 실제 기기에서 소리가 들렸다는 증거는 이 테스트에 없다. 팀원의 별도 음성 구현과 기본 브랜치 구현은 각각 존재하며, `Cross-translate`를 병합한 기록은 없다. [Actions #15](https://github.com/junypark0427/SignBridgeAI/actions/runs/43609789199)

## 3. 현재 AI 동작 원리 — 발표용 설명

1. **손 찾기:** 브라우저의 MediaPipe Hand Landmarker가 VIDEO 모드로 최대 두 손의 손당 21개 좌표와 좌우 정보를 추출한다. `src/mediapipe/handTracker.js`는 GPU 초기화 실패 시 CPU 대체를 시도한다.
2. **동작 저장:** `src/collector/wordCollector.js`가 시간순 프레임, 손 수와 좌표를 한 단어 시퀀스로 기록한다. 손이 감지되지 않은 프레임을 가짜 좌표로 채우지 않는다. 원본 영상은 기본 저장하지 않는다.
3. **전처리:** `src/shared/preprocessing.js`는 손목 기준 상대 좌표와 손 크기 정규화, 좌우별 존재 여부, 원래 손목 위치와 양손 간 상대 위치를 포함하는 137차원 특징을 만든다. 원본과 파생 데이터를 구분한다.
4. **기본 단어 인식:** `src/ai/dtwRecognizer.js`가 입력과 같은 언어의 등록 시퀀스에 같은 검증·트림·전처리를 적용하고 최대 64개 시점으로 정리한다. DTW는 길이와 속도가 다른 동작을 시간 순서에 맞춰 비교한다. 가까운 예시들의 거리를 단어별로 모아 후보를 고른다. 표시 점수는 확률이나 실측 정확도가 아니다. 한 단어·한 샘플도 시험 가능하지만 정확도를 보장하지 않는다.
5. **공통 의미 연결:** `concept_id`가 같은 반대 언어의 등록 이름을 조회한다. 같은 코드만으로 수어 표현의 완전한 대응을 보장하지 않고, 검증 상태와 출처는 따로 표시한다.
6. **문장 실험:** KSL에서 손을 내려 단어를 구분한 뒤 인식 결과를 순서대로 모은다. `src/sentence/lexicon.js`·`koreanPhrase.js`의 제한된 의미 범주·서술어 성분·조사 규칙으로 지원 패턴만 한국어 구절로 만든다. 얼굴·상체·공간 문법과 문맥을 해석하는 완전한 번역은 아니다.
7. **TensorFlow.js의 실제 역할:** `src/ai/trainer.js`와 고급 `#advanced/model` 화면에 학습·모델 저장 코드가 존재하고 합성 데이터 학습 테스트도 있다. 그러나 기본 Try AI는 **학습된 TensorFlow 신경망이 아니라 DTW 비교**를 사용한다. `public/models/registry.json`의 KSL/ASL은 기준 커밋에서 `null`이다. 공개 실수어 학습 모델과 실제 사용자 성능이 완성됐다고 주장할 근거는 없다.

## 4. 기능 상태와 남은 검증

| 상태 | 내용 |
| --- | --- |
| 기능 브랜치에 구현 | 웹캠 수집·좌표/시퀀스, IndexedDB·JSON, 공용 데이터 조회/저장/수정/삭제, 그룹 표시, DTW 단어 비교, 이름 연결, KSL 구절 실험·손 내림 분리, 수동 음성 출력 |
| 실험·검증 중 | 실제 다양한 촬영자·환경의 정확도, 단어 구분 기준, 양손 가림, 자동 분리의 실제 수어 사용성, 음성 출력 기기 호환성 |
| 별도 브랜치 | `design`의 별도 디자인 커밋과 `Cross-translate`의 규칙 기반 데모 |
| 계획 | 더 큰 데이터셋과 독립 사용자 평가, 모델 성능 개선, 검증된 대응 자료, 얼굴·입·상체와 자연스러운 문장 수준 수어 번역 |

Netlify 설정 파일은 `npm run build`·`dist`이며, GitHub Actions 워크플로는 설치·테스트·빌드만 수행한다. **Actions 성공이 Netlify 배포 성공이나 기능 정확도를 의미하지 않는다.** 2026-10-31의 Published는 위의 별도 배포 기록으로 확인되며 다른 각 커밋의 배포 결과를 Actions만으로 소급 확정할 수 없다. 실제 배포 설정·환경 변수의 현재 상태는 이번 문서 분석에서 변경하거나 관리자 화면에서 재검증하지 않았다.

## 5. GitHub Actions 전체 실행 목록

공개 API는 이 작성 시점에 워크플로 1개(`Studio checks`, 과거 실행명 `Collector checks`)와 실행 15개를 반환했다. 각 실행은 첫 시도에서 완료·성공이며 실패한 실행 및 오류 로그는 공개 목록에서 확인되지 않았다. 삭제되었거나 권한 때문에 보이지 않는 이력의 존재 여부는 확인 불가다. 워크플로는 Node 24에서 `npm ci`, `npm test`, `npm run build`를 실행한다.

| 번호 | 시작 시각 KST | 커밋 | 결과 | 기록 |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-24 11:48:11 | `312a6d8` | 성공 | [실행](https://github.com/junypark0427/SignBridgeAI/actions/runs/40055685864) |
| 2 | 2026-10-24 11:49:11 | `5231095` | 성공 | [실행](https://github.com/junypark0427/SignBridgeAI/actions/runs/40055754022) |
| 3 | 2026-10-24 19:40:51 | `c438fd6` | 성공 | [실행](https://github.com/junypark0427/SignBridgeAI/actions/runs/40086870736) |
| 4 | 2026-10-24 20:18:54 | `4aae734` | 성공 | [실행](https://github.com/junypark0427/SignBridgeAI/actions/runs/40089402383) |
| 5 | 2026-10-24 22:26:06 | `68712d9` | 성공 | [실행](https://github.com/junypark0427/SignBridgeAI/actions/runs/40098116262) |
| 6 | 2026-10-31 11:47:41 | `b246391` | 성공 | [실행](https://github.com/junypark0427/SignBridgeAI/actions/runs/41161568867) |
| 7 | 2026-10-31 11:50:20 | `5e6e1ea` | 성공 | [실행](https://github.com/junypark0427/SignBridgeAI/actions/runs/41161756702) |
| 8 | 2026-11-01 00:29:03 | `1e574cf` | 성공 | [실행](https://github.com/junypark0427/SignBridgeAI/actions/runs/41215055131) |
| 9 | 2026-11-01 00:36:38 | `db58ba1` | 성공 | [실행](https://github.com/junypark0427/SignBridgeAI/actions/runs/41215677503) |
| 10 | 2026-11-01 00:47:31 | `93f9ad6` | 성공 | [실행](https://github.com/junypark0427/SignBridgeAI/actions/runs/41216526432) |
| 11 | 2026-11-14 11:12:32 | `df3c7a3` | 성공 | [실행](https://github.com/junypark0427/SignBridgeAI/actions/runs/43544991012) |
| 12 | 2026-11-14 11:27:32 | `79c0495` | 성공 | [실행](https://github.com/junypark0427/SignBridgeAI/actions/runs/43546414761) |
| 13 | 2026-11-14 11:37:58 | `181e7b7` | 성공 | [실행](https://github.com/junypark0427/SignBridgeAI/actions/runs/43547381076) |
| 14 | 2026-11-14 12:00:01 | `d028bd4` | 성공 | [실행](https://github.com/junypark0427/SignBridgeAI/actions/runs/43549274388) |
| 15 | 2026-11-15 00:21:57 | `c5f237f` | 성공 | [실행](https://github.com/junypark0427/SignBridgeAI/actions/runs/43609789199) |

## 6. 이번 문서 작성 시 확인

- 원격 브랜치 목록 및 기본 브랜치, 공개 PR·Actions API를 읽기 전용으로 확인했다. `gh` CLI는 이 환경에서 찾지 못해 공개 GitHub API를 사용했다.
- 현재 `c5f237f` 코드에서 `npm test` **98개 통과**, `npm run build` 성공을 실행 확인했다. 빌드에서 500kB를 넘는 청크 경고가 나왔고 실패는 아니었다. 이번 검사에 실제 수어 수행이나 실제 음성 청취는 포함되지 않았다.
- Git과 과거 기록에 확인되지 않은 브랜치 충돌·Netlify 실패·정확도 개선 수치를 새로 만들어 넣지 않았다.
