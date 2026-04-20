// main.js
import { login, handleRedirect } from "./src/api/authService.js";

document.addEventListener('DOMContentLoaded', () => {
    handleRedirect().then(user => {
        if (user) console.log("로그인 성공");
    });
    
    document.getElementById('login-btn')?.addEventListener('click', login);
});