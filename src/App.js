/**
 * App.js — Stellara 메인 진입점 (Entry Point)
 *
 * 책임:
 *   - 모든 Manager를 순서에 맞게 초기화
 *   - Manager 간 의존성 주입 (DI)
 *   - 로딩 시퀀스 오케스트레이션
 *   - window 객체 오염 없이 모든 상태를 StellaraState로 격리
 *
 * 초기화 순서:
 *   1. StellaraState  — 상태 저장소 준비
 *   2. SceneManager   — Three.js 렌더러·씬·카메라 마운트
 *   3. PlanetManager  — 행성 씬 빌드 + tick 연결
 *   4. EffectsManager — 별·성운·블랙홀·슈팅스타 빌드 + tick 연결
 *   5. UIManager      — DOM 이벤트 구독 + 상태 → UI 반영
 *   6. InputManager   — 입력 이벤트 캡슐화
 *   7. AudioManager   — 오디오 상태 머신 시작
 *   8. SceneManager.start() — 렌더 루프 개시
 *   9. LoadingManager — 로딩 애니메이션 → 완료 전환
 */

import { state }        from './core/StellaraState.js';
import { SceneManager } from './core/SceneManager.js';
import { InputManager } from './core/InputManager.js';
import { PlanetManager } from './managers/PlanetManager.js';
import { AudioManager } from './managers/AudioManager.js';
import { EffectsManager } from './managers/EffectsManager.js';
import { UIManager }    from './managers/UIManager.js';

// ── App 클래스 ────────────────────────────────────────────
class App {
  constructor() {
    // 디버그 모드 (개발 환경에서 활성화)
    if (process?.env?.NODE_ENV === 'development') {
      state.enableDebug();
    }

    /** @type {SceneManager}  */ this.scene    = null;
    /** @type {InputManager}  */ this.input    = null;
    /** @type {PlanetManager} */ this.planets  = null;
    /** @type {EffectsManager}*/ this.effects  = null;
    /** @type {UIManager}     */ this.ui       = null;
    /** @type {AudioManager}  */ this.audio    = null;
  }

  /**
   * 애플리케이션을 초기화하고 실행합니다.
   */
  async init() {
    console.group('[Stellara] 초기화 시작');

    try {
      // 1. SceneManager — Three.js 환경 구성
      this.scene = new SceneManager(document.body);

      // 2. PlanetManager — 행성 씬 빌드 + tick 연결
      this.planets = new PlanetManager(
        this.scene.scene,
        this.scene.camera,
        this.scene.renderer.domElement
      );
      this.scene.addTickHandler(this.planets.tick.bind(this.planets));

      // 3. EffectsManager — 환경 이펙트 빌드 + tick 연결
      this.effects = new EffectsManager(this.scene.scene);
      this.scene.addTickHandler(this.effects.tick.bind(this.effects));

      // 4. UIManager — DOM ↔ StellaraState 바인딩
      //    PlanetData 접근이 필요하므로 planets 참조 전달
      this.ui = new UIManager(this.planets);

      // 5. InputManager — 입력 이벤트 캡슐화 (SceneManager canvas 사용)
      this.input = new InputManager(this.scene.renderer.domElement);

      // 6. AudioManager — 오디오 상태 머신
      this.audio = new AudioManager();

      // 7. 렌더 루프 시작
      this.scene.start();

      // 8. 로딩 시퀀스 실행 (비동기)
      await this._runLoadingSequence();

      console.info('[Stellara] 초기화 완료 ✓');
    } catch (err) {
      console.error('[Stellara] 초기화 실패:', err);
    } finally {
      console.groupEnd();
    }
  }

  /**
   * 로딩 UI 애니메이션 + 완료 후 씬 공개
   */
  _runLoadingSequence() {
    return new Promise((resolve) => {
      const MESSAGES = [
        '별빛을 모으는 중...',
        '행성 궤도 계산 중...',
        '성운을 배치하는 중...',
        '우주가 열리고 있습니다...',
      ];

      const barEl = document.getElementById('ld-bar');
      const txtEl = document.getElementById('ld-txt');
      const loadEl = document.getElementById('loading');

      if (!barEl || !loadEl) { resolve(); return; }

      let pct = 0;
      const iv = setInterval(() => {
        pct = Math.min(100, pct + Math.random() * 16);
        barEl.style.width = pct + '%';
        txtEl.textContent = MESSAGES[Math.min(3, Math.floor(pct / 26))];

        if (pct >= 100) {
          clearInterval(iv);
          setTimeout(() => {
            loadEl.classList.add('done');
            state.setPath('ui.loadingComplete', true);
            resolve();
          }, 400);
        }
      }, 110);
    });
  }

  /**
   * 애플리케이션 전체 리소스를 해제합니다.
   */
  destroy() {
    this.audio?.destroy();
    this.ui?.destroy();
    this.input?.destroy();
    this.effects?.destroy();
    this.planets?.destroy();
    this.scene?.destroy();
    console.info('[Stellara] 앱 종료');
  }
}

// ── 진입점 ────────────────────────────────────────────────
// DOMContentLoaded를 기다린 후 초기화
const app = new App();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.init());
} else {
  app.init();
}

// HMR 지원 (Vite 환경)
if (import.meta.hot) {
  import.meta.hot.dispose(() => app.destroy());
}

export { app };
