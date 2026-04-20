import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAYKL1ur0AnvZfTLN7-xt0yzmuoo4HUTfk",
  authDomain: "stellara-v2.firebaseapp.com",
  projectId: "stellara-v2",
  storageBucket: "stellara-v2.firebasestorage.app",
  messagingSenderId: "606298995681",
  appId: "1:606298995681:web:85769c58c11d2881b030a0",
  measurementId: "G-5C7V6PJRGB"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);