# 이중 이미지 메이커 Android

Android 10(API 29) 이상. Kotlin 셸에서 APK에 포함된 HTML/Canvas를 실행한다.
기존 웹의 합성 계산, 입력 알파 처리, 출력 크기와 기본 늘이기를 그대로 유지한다.
배경 추가와 중앙 크롭은 사용자가 선택할 때만 적용된다. 해상도 자동 제한은 없다.

## 사용
1. 라이트/다크 사진 선택 → 크기 맞추기 선택(기본: 늘이기).
2. 이미지 생성 → 흰색/검정 배경으로 확인.
3. PNG 저장 또는 공유. 공유 시에도 갤러리에 PNG가 먼저 저장된다.
4. 갤러리의 `Pictures/DualImageMaker`에서 결과를 찾는다.
5. **다른 위치에 저장**을 누르면 시스템 저장 창에서 폴더와 파일 이름을 선택할 수 있다. 취소하면 결과는 그대로 남고 다시 저장할 수 있다.

인터넷이나 전체 사진 접근 권한을 요청하지 않는다. 입력은 시스템 사진 선택기를 사용한다.
회전 시 화면을 유지한다. OS가 앱 프로세스를 종료하거나 앱을 닫은 뒤 다시 열면 입력 사진을 다시 선택한다.
저장 결과는 투명 PNG이며 다른 앱이 JPEG로 변환하면 효과가 유지되지 않는다.

## 빌드 및 검증
- JDK 17, Gradle 8.11.1, Android SDK 35 / Build Tools 35.0.0.
- Android Studio에서 이 `android/` 폴더를 연다.
- 터미널: `gradle :app:assembleDebug :app:lintDebug`.
- 저장소 루트: `npm ci`, `npx playwright install chromium`, `npm test`.
- GitHub Actions `Android APK`에서 빌드와 회귀 테스트 후 `dual-image-maker-apk` 다운로드.

첫 APK는 Android debug 키로 서명되는 설치/테스트용이다. 장기 배포 시 개인 서명키를 별도 보관해야 한다.
CI 환경마다 debug 서명키가 달라질 수 있어 이전 빌드와 서명이 다르면 기존 앱 삭제 후 설치가 필요하다.
원본 웹은 저장소 루트 `index.html`, 앱 화면은 `app/src/main/assets/index.html`.
진행 및 재개 기록은 저장소 루트 `WORK_LOG.md`를 읽는다.
