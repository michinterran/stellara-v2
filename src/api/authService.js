import { auth } from "./firebaseConfig.js";
import { signInWithRedirect, GoogleAuthProvider, getRedirectResult } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

const provider = new GoogleAuthProvider();

export async function login() {
    await signInWithRedirect(auth, provider);
}

export async function handlerRedirect() {
    const result = await getRedirectResult(auth);
    return result;
}