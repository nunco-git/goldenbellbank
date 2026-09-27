// ===================================================================
// Firebase 프로젝트 설정
// Firebase 콘솔 > 프로젝트 설정 > 일반 > "내 앱"에서 발급받은 값을
// 아래에 그대로 붙여넣으세요. (README.md 참고)
// ===================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCrOZELRNzI_2XJCq8UIUUSYPseOxVvbs0",
  authDomain: "goldenbellbank.firebaseapp.com",
  projectId: "goldenbellbank",
  storageBucket: "goldenbellbank.firebasestorage.app",
  messagingSenderId: "362800291607",
  appId: "1:362800291607:web:1599383651dcb8e169a152",
  measurementId: "G-N5GPC4GYYZ"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);

// 골든벨 관리자로 지정할 이메일 목록 (선택적 보조 수단)
// Firestore users/{uid} 문서의 role 필드를 "admin"으로 직접 바꾸는 것이 기본 방법이며,
// 아래 목록은 최초 로그인 시 자동으로 admin 권한을 부여하고 싶을 때만 사용합니다.
export const BOOTSTRAP_ADMIN_EMAILS = [
  // "nunco@naver.com",
];
