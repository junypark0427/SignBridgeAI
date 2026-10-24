# 언어별 모델 학습과 공용 배포

현재 실제 수어로 학습·검증한 공개 모델은 없으며 registry.json의 KSL/ASL은 null입니다. 합성 QA 모델을 실제 수어 모델로 배포하지 마세요.

학습시키기 → AI 모델 학습에서 언어와 Supabase/로컬 자료를 고릅니다. 단어 2개 이상, 각 단어 최소 학습 2개·독립 검증 1개가 필요합니다. 이 최소량은 정확도 보장 기준이 아닙니다. 한국어/영어 표기는 담당자가 검증한 값만 입력하고, 교차 표현은 같은 concept_id·양쪽 검증 표시·출처가 있어야 합니다. Epoch·검증 Loss/Accuracy를 확인하고 미참여 촬영자로 최종 평가하세요. 중단 시 부분 모델은 저장하지 않습니다.

## 다운로드

모델 파일 다운로드는 아래 파일들을 요청합니다. 브라우저의 여러 파일 다운로드 차단 여부를 확인하세요.

```text
model.json
model.weights.bin
metadata.json
```

같은 학습 결과의 파일을 사용하고 `(1)` 등이 붙으면 이름을 맞추세요. model.json의 weightsManifest[].paths도 실제 .bin과 일치해야 합니다. 불러오기는 세 파일(여러 shard면 모든 .bin)을 함께 선택하며 최대 100MB입니다. 언어·입력·전처리·모델 버전을 검사합니다.

metadata는 단어 순서·의미 코드·한국어/영어·검증 대응·언어·스키마/전처리/입력 버전·검증 통계·임계값·model_version을 포함합니다. model.json 내부 메타데이터와 외부 파일 버전이 같아야 합니다. 브라우저 저장은 해당 주소·프로필의 IndexedDB에만 존재합니다.

## 프로젝트 배치

```text
public/models/
  hand_landmarker.task       # 기존 파일 유지
  manifest.json              # 기존 손 검출 모델 해시·출처 유지
  registry.json
  ksl/model.json
  ksl/model.weights.bin
  ksl/metadata.json
  asl/model.json
  asl/model.weights.bin
  asl/metadata.json
```

KSL만 실제로 배치했다면 registry 예시:

```json
{ "KSL": "ksl/metadata.json", "ASL": null }
```

ASL도 준비되면 `"ASL":"asl/metadata.json"`으로 변경합니다. 없는 파일을 목록에 등록하지 마세요. Vite는 public 파일을 dist로 복사합니다.

## 기존 사이트 반영

1. 기존 저장소 기능 브랜치에 검증한 공개 모델·registry만 명시적으로 추가합니다. main 직접 Push, 실제 데이터/.env.local/합성 QA 모델 포함은 하지 않습니다.
2. npm test·npm run build 후 dist/models/<language>의 파일을 확인합니다.
3. Commit/Push하고 팀 통합 절차로 기존 Netlify 빌드 브랜치에 반영하거나 해당 기능 브랜치를 배포합니다.
4. 기존 signbridgeai1.netlify.app를 재배포합니다. 새 사이트를 만들지 않습니다.
5. 다른 브라우저/컴퓨터의 직접 해보기에서 ‘사이트 배포 모델’ 표시를 확인합니다. 이 브라우저 모델 사용은 공개 배포 확인을 대체하지 않습니다.

브라우저에서 GitHub/Netlify로 자동 업로드하지 않습니다. 공개 모델은 누구나 내려받을 수 있으므로 사용 범위·어휘·출처를 팀에서 검토하세요.

기본 모델은 32 시간 단계 × 138 특징의 Temporal Conv1D이며 학습·체험은 같은 전처리/시간 리샘플링을 사용합니다. 원본은 바꾸지 않습니다. 기본 확정 기준은 Softmax 상위값 0.75 이상, 1·2위 차이 0.15 이상입니다. 실측 보정 전 설정이며 미등록 동작 검출을 보장하지 않습니다. 실제 어휘·새 촬영자·조명·양손 가림·단어 경계는 별도 평가합니다. 연속 인식·문장 번역은 구현하지 않습니다.
