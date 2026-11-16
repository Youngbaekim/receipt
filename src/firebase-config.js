// Firebase 웹 앱 설정값 — YB-EverNote와 같은 프로젝트(yb-evernote)를 함께 사용
// 비밀번호가 아닌 프로젝트 식별 정보이므로 공개 저장소에 포함해도 됩니다.
// 데이터 보호는 Firestore 보안 규칙(users/{uid}/… 본인만, 허용 목록 계정만)이 담당합니다.
export const firebaseConfig = {
  apiKey: "AIzaSyDed_82FnYLwIu69xiGZ86pu4oOsCHp8h4",
  authDomain: "yb-evernote.firebaseapp.com",
  projectId: "yb-evernote",
  storageBucket: "yb-evernote.firebasestorage.app",
  messagingSenderId: "361528963812",
  appId: "1:361528963812:web:6d63b1dddcb377cd0572f1",
};

// App Check(남용 방지) — Firebase 콘솔 → App Check 에서 웹 앱을 등록하고 받은 reCAPTCHA 사이트 키를 넣습니다.
// 사이트 키는 비밀번호가 아니므로 공개 저장소에 포함해도 됩니다. 비워 두면 App Check 를 쓰지 않습니다.
// provider: 'enterprise'(reCAPTCHA Enterprise) 또는 'v3'(reCAPTCHA v3) — 콘솔에서 등록한 종류와 같아야 합니다.
export const appCheck = { provider: 'enterprise', siteKey: '6LfMJiMuAAAAACU_P2oYaLPc0vFE8_0Jzb4WLYW5' };
