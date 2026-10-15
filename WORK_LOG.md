# Android APK 작업 기록

## 사용자 요구사항 — 변경 금지
- 기준 웹 코드: main 커밋 2805af0e177ed3fadee575f26328f8f780103238.
- 핵심 픽셀 합성 계산을 그대로 유지한다. 입력 알파 처리, 명도, 감마, 반올림을 임의로 바꾸지 않는다.
- 출력 width=min(두 이미지 width), height=min(두 이미지 height)를 그대로 유지한다.
- 기본 리사이즈는 현재의 늘이기다. 해상도 제한/자동 축소를 추가하지 않는다.
- 사용자가 선택하는 배경 추가(라이트 흰색/다크 검정), 중앙 크롭 옵션만 추가한다.
- 단계마다 원격 브랜치에 저장한다. 특히 검증을 실행하기 전에 커밋/푸시한다.

## 구현 결정
- Kotlin Android 셸 + APK에 포함한 로컬 WebView 화면을 사용한다. 기존 JavaScript/Canvas 계산을 그대로 실행해 네이티브 재구현에 따른 픽셀 차이를 피한다.
- 웹 원본 index.html은 유지하고 android/app/src/main/assets/index.html에 앱 화면을 만든다.
- Android Photo Picker, MediaStore PNG 저장, 시스템 공유를 연결한다.
- 인터넷/광범위한 저장소 권한 없이 Android 10 이상 지원.
- GitHub Actions에서 APK 빌드 및 브라우저 회귀 검증. 설치용 첫 결과는 debug 서명 APK이며 장기 배포용 개인 서명키는 별도 관리가 필요하다.

## 진행 상태
- [x] 기준 소스 확인 및 작업 브랜치 생성
- [x] 앱 소스 및 빌드 설정 구현
- [x] 검증 전 원격 체크포인트 저장
- [x] 기존 계산/크기 보존 및 신규 옵션 회귀 검증
- [x] Android 컴파일/lint 및 APK 서명 확인
- [x] APK 다운로드 파일 저장

## 재개 방법
1. codex/android-apk 브랜치를 checkout하고 이 문서와 최근 커밋을 읽는다.
2. 소스가 수정되어 있으면 검증 전에 커밋/푸시한다.
3. GitHub Actions의 Android APK 워크플로 실행 결과와 아티팩트를 확인한다.
4. 실패 로그에 근거한 수정만 하고 다시 저장한 뒤 검증한다.

## 검증 범위
소스 구현 완료. 검증 전에 원격 체크포인트를 저장했다. 기존 웹은 변경하지 않았고 앱의 합성 루프를 원본에서 그대로 복사했다.
기존 PNG와 바이트 단위 동등성, 2048px 초과 폭 유지, 투명 입력, 선택 옵션, 오류 복구, 중복 생성, 저장 브리지 테스트를 작성했다.
브라우저 회귀 검증 및 Android 빌드를 완료했다. 실제 Galaxy S24+ 기기는 연결되지 않았으므로 실기기 검증을 했다고 주장하지 않는다.

직접 git push는 인증이 없어 실패했다. GitHub 커넥터의 create_tree/create_commit/update_ref로 원격 체크포인트를 저장한다.
원격 초기 기록 커밋: 4e08a815ae1cf6ee133fee992cc90cdea5e2feac.

## 검증 1
- 소스 체크포인트: 5e95b6731fa8fd49d917df6a95bfa14de8dcdfde.
- Actions 실행 38687576339에서 Chromium 회귀 테스트 6개 모두 통과.
- 기본 모드 PNG가 원본과 바이트 단위로 동일(투명 입력, 서로 다른 비율, 2048px 초과 폭 포함).
- APK 빌드 전에 SDK 설정 액션이 폐지된 `tools` 패키지를 설치하려다 실패.
- 워크플로에서 설치 패키지를 `platform-tools`로 명시해 수정. 수정 저장 후 재검증한다.
- 로컬 환경에서는 Chromium 다운로드가 잘못된 ZIP을 반환하므로 브라우저 검증은 Actions에서 수행한다.

## 최종 결과
- 빌드한 소스: 786e7a8da42ac5eea2dbfd668f716fca34ef1416.
- 성공한 실행: https://github.com/mikotolover/Image-generator/actions/runs/38687716762
- Chromium 테스트: 6/6 통과. Kotlin 컴파일, assembleDebug, lintDebug, apksigner verify 성공.
- Lint: 오류 0, 경고 4(최신 target SDK 미사용 1, 최신 의존성 미사용 2, 데이터 추출 규칙 미지정 1). 현재 앱은 입력 이미지를 내부 파일에 저장하지 않는다.
- 화면 캡처에서 모바일 레이아웃 확인. 실제 Android Photo Picker/MediaStore/공유의 기기 동작 검증은 아직 수행하지 않았다.
- APK: dual-image-maker-1.0.0-debug.apk / 5,817,314 bytes / Android 10 이상 / 테스트용 debug 서명.
- APK SHA-256: 22ec42079d23ca8b83c32c8cf2fb100035f6a33e06f45a19cc0264bbdee85f07.
- 서명 인증서 SHA-256: a3363ea956a79bb38a6bba188e2f0b7c0869b136f3e8fcac3f2092f0d31007c8.
- 로컬로 받은 APK의 체크섬 및 내부 assets/index.html이 검증한 소스와 동일함을 확인했다.
- APK 다운로드 파일 저장 완료. GitHub APK 아티팩트 ID 11950808757(90일 보관), 검증 보고서 ID 11950703817.
- 원본 main 및 루트 index.html은 변경하지 않았다. 이후 작업은 codex/android-apk에서 이어간다.
- 다음 기기 확인 항목: 사진 선택/취소 → 생성 → 갤러리 PNG 저장 → 공유 → 화면 회전.

## 추가 검증 요청 (2026-10-15)
- 전달한 APK 그대로 Android 15(API 35) 에뮬레이터에 설치해 검증한다. 앱 코드/알고리즘은 변경하지 않는다.
- `device-tests/verify.cjs`와 별도 Actions 워크플로를 작성했다.
- 실제 Android Photo Picker 선택/취소, WebView 생성, MediaStore 저장 바이트 비교, 공유 창, 회전, 세 모드, 실패 복구를 확인한다.
- 검증 실행 전에 이 변경을 원격 브랜치에 저장한다. 실행 결과는 아직 미확인.

### 에뮬레이터 검증 1
- 커밋 c237a00ccfe5bf2e34dca6dc9d72c0bea109de4e / 실행 38689012781.
- 전달 APK 체크섬 일치, Android 15 설치/실행 성공, 시스템 사진 선택기 열림 확인.
- ADB로 복사한 테스트 사진이 미디어 스캔 브로드캐스트 후에도 선택기에 나타나지 않아 중단. 앱 오류로 판정하지 않았다.
- 테스트 사진을 기존 앱의 실제 MediaStore 저장 브리지로 등록하도록 검증 코드만 수정했다. 로그 출력 버퍼도 확장했다.
- 수정 저장 후 재실행한다. 앱 소스와 APK는 그대로다.

### 에뮬레이터 검증 2
- 커밋 21ee0115b679af6c305eb42a0b119faf1254df4a / 실행 38691574040.
- 설치, 사진 선택/취소, 생성, 미리보기, PNG 원본 바이트 보존 저장, MediaStore 등록, 공유 창, 회전, 배경 추가/크롭, 교환, 손상 파일 오류 처리 통과.
- 마지막 오류 복구 검사에서 테스트의 사진 선택 대기 조건이 기존 파일 1개를 새 선택 완료로 오인했다. 뒤늦은 change 이벤트가 결과를 무효화한 화면을 확인했다.
- 테스트가 실제 input change 이벤트를 받은 뒤 진행하도록 수정한다. 앱 코드는 변경하지 않는다. 저장 후 재실행.

### 에뮬레이터 검증 3
- 커밋 43ac283b587adee3490184d3dd3662089d6809c3 / 실행 38691982338.
- 사진 2장은 MediaStore에 정상 등록됐지만 Pixel Launcher 응답 없음 시스템 창이 선택기를 가려 테스트 중단.
- UI 덤프에서 정확한 원인을 확인했다. 해당 런처의 창만 닫도록 테스트를 보완한다. 앱 자체의 ANR은 무시하지 않는다.
- 앱/APK 변경 없이 검증 코드와 기록을 저장한 뒤 다시 실행한다.
