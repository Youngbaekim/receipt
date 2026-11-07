# YB-Receipt

업무 영수증 증빙 관리 앱 (PWA) — 촬영 → 기기 안 글자 인식 → 정산 상태 관리 → 엑셀·인쇄

## 실행 방법 (PowerShell)

```
cd C:\dev\yb-receipt
npm install      # 처음 한 번만 (글자 인식 엔진을 public/ocr 로 자동 복사)
npm run dev      # 개발 서버 → 화면에 나오는 주소를 브라우저로 열기
```

- 점검용 가짜 저장소: 개발 서버 주소 끝에 `?demo` (로그인 없이 화면 점검, 새로고침하면 지워짐)
- 배포: `main` 브랜치에 올리면 GitHub Actions가 자동으로 GitHub Pages에 배포
- 새 버전 안내를 띄우려면 `public/sw.js`의 `VERSION`과 `package.json`의 `version`을 올린 뒤 배포

## 구성

| 항목 | 내용 |
|---|---|
| 로그인·동기화 | YB-EverNote와 같은 Firebase 프로젝트(yb-evernote), Google 로그인, 허용 목록 계정만 |
| 저장 위치 | Firestore `users/{uid}/receipts`(정보·미리보기) · `users/{uid}/receiptImages`(사진, JPEG 긴 변 1,280px·200KB 이하) |
| 배포 주소 | https://youngbaekim.github.io/receipt/ (저장소 youngbaekim/receipt) |
| 글자 인식 | Tesseract.js 한글+영문, 기기 안에서 처리(사진을 외부 서버로 보내지 않음). 가로 사진 자동 회전, 공급가액+부가세 검산으로 금액 보정 |
| 관리 항목 | 일자 · 가맹점 · 금액 · 정산 상태(미제출/제출/정산완료) · 메모 |
| 내보내기 | 엑셀(.xlsx), 증빙 인쇄·PDF(A4: 목록표 + 사진 2장/쪽), 전체 백업·복원(JSON) |

## 개발 단계

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 촬영·글자 인식·목록·정산 상태·엑셀·인쇄·백업 | 완료 (v0.1.0) |
| 1.1 | 선택한 영수증 일괄 삭제 | 완료 (v0.1.1) |
| 1.2 | 목록·상세 일자에 요일 표시 (토 파랑·일 빨강) | 완료 (v0.1.2) |
| 1.3 | 보관 사진 긴 변 1,280px·200KB 이하로 축소 | 완료 (v0.1.3) |
| 1.4 | 상세 화면 사진·내용 미표시 오류 수정, 휴대폰 목록↔상세 전환(‹ 목록·뒤로 단추) | 완료 (v0.1.4) |
