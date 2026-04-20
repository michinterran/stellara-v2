// main.js
import { login, handlerRedirect } from "./src/api/authService.js";

document.addEventListener('DOMContentLoaded', () => {
    // 1. 로그인 결과 확인
    handlerRedirect().then((result) => {
        if (result) {
            console.log("로그인 성공!", result.user);
        }
    });

    // 2. 버튼 클릭 시 로그인 실행
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', login);
    }
});