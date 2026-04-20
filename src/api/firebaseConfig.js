// src/api/firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  // 방금 화면에서 복사한 긴 코드(apiKey 등)를 여기에 넣으십시오
  apiKey: "지휘관님 화면의 apiKey를 넣으세요",
  authDomain: "stellara-v2.firebaseapp.com",
  projectId: "stellara-v2",
  storageBucket: "stellara-v2.firebasestorage.app",
  messagingSenderId: "606298995681",
  appId: "1:606298995681:web:85769c58c11d2881b030a0",
  measurementId: "G-5C7V6PJRGB"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);