// src/api/authService.js
import { auth } from "./firebaseConfig.js";
import { GoogleAuthProvider, signInWithRedirect, getRedirectResult } from "firebase/auth";

const provider = new GoogleAuthProvider();

export async function login() {
    await signInWithRedirect(auth, provider);
}

export async function handleRedirect() {
    const result = await getRedirectResult(auth);
    return result;
}