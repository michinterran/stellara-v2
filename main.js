import { login, handlerRedirect } from "./src/api/authService.js";

document.addEventListener('DOMContentLoaded', () => {
    console.log("페이지가 로드되었습니다. 로그인 결과를 확인 중..."); // 확인용 로그 추가

    handlerRedirect().then((result) => {
        if (result) {
            console.log("로그인 성공! 유저 정보:", result.user);
            alert("로그인 성공!");
        } else {
            console.log("로그인 대기 중이거나 로그인된 상태가 아닙니다.");
        }
    }).catch((error) => {
        console.error("로그인 중 에러 발생:", error);
    });

    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            console.log("로그인 버튼 클릭됨!");
            login();
        });
    }
});