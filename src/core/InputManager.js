/**
 * InputManager — 입력 이벤트 캡슐화 모듈
 *
 * 책임:
 *   - pointer(mouse/touch), wheel, keyboard 이벤트를 캡슐화
 *   - Raw 이벤트를 정규화된 입력 데이터로 변환
 *   - 처리된 입력 데이터를 StellaraState에 반영
 *   - 3D 인터랙션(드래그·줌)과 UI 클릭 이벤트를 분리
 *   - 직접적인 DOM 조작 또는 Three.js 호출 금지
 *
 * 이벤트 흐름:
 *   Raw DOM Event → normalize() → StellaraState.setState()
 *   → SceneManager / UIManager가 구독하여 반응
 */

import { state } from './StellaraState.js';

// ── 상수 ───────────────────────────────────────────────────
const DRAG_THRESHOLD_PX = 5;       // 드래그 vs 클릭 판별 임계값
const AUTO_ROTATE_DELAY_MS = 3500; // 조작 후 자동 회전 재개 지연
const DOUBLE_TAP_MS = 350;         // 더블탭 판별 임계값
const WHEEL_SENSITIVITY = 0.12;
const DRAG_SENSITIVITY_MOUSE = 0.004;
const DRAG_SENSITIVITY_TOUCH = 0.005;
const CAM_DIST_MIN = 50;
const CAM_DIST_MAX = 220;
const CAM_PHI_MIN = 0.15;
const CAM_PHI_MAX = Math.PI - 0.15;

// ── InputManager 클래스 ────────────────────────────────────
export class InputManager {
  /**
   * @param {HTMLCanvasElement} canvas - Three.js 렌더러의 canvas 요소
   */
  constructor(canvas) {
    this._canvas = canvas;
    this._autoRotateTimer = null;

    // 드래그 세션 추적 (렌더 루프 내 할당 방지용 미리 선언)
    this._dragStartX = 0;
    this._dragStartY = 0;
    this._movedSinceDown = false;

    // 더블탭 추적
    this._lastTouchEndTime = 0;

    // 핀치 줌 추적
    this._prevPinchDist = 0;

    // 이벤트 리스너 참조 보관 (destroy 시 정리용)
    this._listeners = [];

    this._init();
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * 모든 이벤트 리스너를 제거합니다.
   */
  destroy() {
    for (const { target, type, handler, options } of this._listeners) {
      target.removeEventListener(type, handler, options);
    }
    this._listeners = [];
    clearTimeout(this._autoRotateTimer);
    console.info('[InputManager] 정리 완료');
  }

  // ── Init ───────────────────────────────────────────────────

  _init() {
    // Pointer (Mouse + Pen)
    this._on(this._canvas, 'pointerdown', this._onPointerDown.bind(this));
    this._on(window, 'pointermove', this._onPointerMove.bind(this));
    this._on(window, 'pointerup', this._onPointerUp.bind(this));

    // Wheel
    this._on(this._canvas, 'wheel', this._onWheel.bind(this), { passive: true });

    // Click (단일 클릭 → 행성 선택)
    this._on(this._canvas, 'click', this._onClick.bind(this));

    // Double Click (줌아웃)
    this._on(this._canvas, 'dblclick', this._onDblClick.bind(this));

    // Touch (모바일)
    this._on(this._canvas, 'touchstart', this._onTouchStart.bind(this), { passive: true });
    this._on(this._canvas, 'touchmove', this._onTouchMove.bind(this), { passive: true });
    this._on(this._canvas, 'touchend', this._onTouchEnd.bind(this), { passive: true });

    // Keyboard
    this._on(window, 'keydown', this._onKeyDown.bind(this));

    // 리사이즈 (SceneManager가 구독하여 처리)
    this._on(window, 'resize', this._onResize.bind(this));

    console.info('[InputManager] 초기화 완료');
  }

  // ── Pointer Events ─────────────────────────────────────────

  _onPointerDown(e) {
    if (!this._isIdle()) return;

    this._dragStartX = e.clientX;
    this._dragStartY = e.clientY;
    this._movedSinceDown = false;

    state.setState({
      input: {
        ...state.get('input'),
        isDragging: true,
        prevPointer: { x: e.clientX, y: e.clientY },
      },
    });

    state.setPath('camera.autoRotate', false);
    this._cancelAutoRotateTimer();
  }

  _onPointerMove(e) {
    // NDC 좌표 갱신 (항상 — 호버 감지용)
    const ndcX = (e.clientX / window.innerWidth) * 2 - 1;
    const ndcY = -(e.clientY / window.innerHeight) * 2 + 1;

    const inputNow = state.get('input');
    const isDragging = inputNow.isDragging;

    if (!isDragging || !this._isIdle()) {
      // 호버 감지만 위해 포인터 좌표 갱신
      state.setPath('input.pointer', { x: ndcX, y: ndcY });
      return;
    }

    const dx = e.clientX - inputNow.prevPointer.x;
    const dy = e.clientY - inputNow.prevPointer.y;

    // 드래그 임계값 체크
    if (
      Math.abs(e.clientX - this._dragStartX) > DRAG_THRESHOLD_PX ||
      Math.abs(e.clientY - this._dragStartY) > DRAG_THRESHOLD_PX
    ) {
      this._movedSinceDown = true;
    }

    // 구면 좌표 갱신
    const cam = state.get('camera');
    const newTheta = cam.targetSpherical.theta - dx * DRAG_SENSITIVITY_MOUSE;
    const newPhi = this._clamp(
      cam.targetSpherical.phi + dy * DRAG_SENSITIVITY_MOUSE,
      CAM_PHI_MIN,
      CAM_PHI_MAX
    );

    state.setState({
      input: {
        ...inputNow,
        pointer: { x: ndcX, y: ndcY },
        prevPointer: { x: e.clientX, y: e.clientY },
      },
      camera: {
        ...cam,
        targetSpherical: { theta: newTheta, phi: newPhi },
      },
    });
  }

  _onPointerUp() {
    const input = state.get('input');
    if (!input.isDragging) return;

    state.setState({
      input: {
        ...input,
        isDragging: false,
      },
    });

    this._scheduleAutoRotate();
  }

  // ── Click ──────────────────────────────────────────────────

  _onClick(e) {
    // 드래그 후 발생하는 클릭 무시
    if (this._movedSinceDown) return;
    if (!this._isIdle()) return;

    // SceneManager가 구독하여 레이캐스팅을 수행하도록
    // 클릭 이벤트 페이로드를 상태로 발행
    state.setState({
      input: {
        ...state.get('input'),
        clickEvent: {
          x: (e.clientX / window.innerWidth) * 2 - 1,
          y: -(e.clientY / window.innerHeight) * 2 + 1,
          timestamp: performance.now(),
        },
      },
    });
  }

  _onDblClick() {
    const phase = state.get('zoom').phase;
    if (phase === 'landed') {
      state.setState({ zoom: { ...state.get('zoom'), phase: 'zooming-out', progress: 0 } });
    }
  }

  // ── Wheel ──────────────────────────────────────────────────

  _onWheel(e) {
    if (!this._isIdle()) return;

    const cam = state.get('camera');
    const newDist = this._clamp(
      cam.targetDistance + e.deltaY * WHEEL_SENSITIVITY,
      CAM_DIST_MIN,
      CAM_DIST_MAX
    );

    state.setState({
      camera: { ...cam, targetDistance: newDist, autoRotate: false },
    });

    this._scheduleAutoRotate();
  }

  // ── Touch Events ───────────────────────────────────────────

  _onTouchStart(e) {
    if (!this._isIdle()) return;

    if (e.touches.length === 2) {
      // 핀치 줌 시작
      this._prevPinchDist = this._getPinchDist(e.touches);
      return;
    }

    const t = e.touches[0];
    this._dragStartX = t.clientX;
    this._dragStartY = t.clientY;
    this._movedSinceDown = false;

    state.setState({
      input: {
        ...state.get('input'),
        isDragging: true,
        prevPointer: { x: t.clientX, y: t.clientY },
      },
    });

    state.setPath('camera.autoRotate', false);
    this._cancelAutoRotateTimer();
  }

  _onTouchMove(e) {
    if (!this._isIdle()) return;

    if (e.touches.length === 2) {
      // 핀치 줌
      const dist = this._getPinchDist(e.touches);
      const delta = this._prevPinchDist - dist;
      this._prevPinchDist = dist;

      const cam = state.get('camera');
      const newDist = this._clamp(
        cam.targetDistance + delta * 0.5,
        CAM_DIST_MIN,
        CAM_DIST_MAX
      );
      state.setState({ camera: { ...cam, targetDistance: newDist } });
      return;
    }

    if (!state.get('input').isDragging) return;

    const t = e.touches[0];
    const input = state.get('input');
    const dx = t.clientX - input.prevPointer.x;
    const dy = t.clientY - input.prevPointer.y;

    if (
      Math.abs(t.clientX - this._dragStartX) > DRAG_THRESHOLD_PX ||
      Math.abs(t.clientY - this._dragStartY) > DRAG_THRESHOLD_PX
    ) {
      this._movedSinceDown = true;
    }

    const cam = state.get('camera');
    const newTheta = cam.targetSpherical.theta - dx * DRAG_SENSITIVITY_TOUCH;
    const newPhi = this._clamp(
      cam.targetSpherical.phi + dy * DRAG_SENSITIVITY_TOUCH,
      CAM_PHI_MIN,
      CAM_PHI_MAX
    );

    state.setState({
      input: {
        ...input,
        prevPointer: { x: t.clientX, y: t.clientY },
      },
      camera: {
        ...cam,
        targetSpherical: { theta: newTheta, phi: newPhi },
      },
    });
  }

  _onTouchEnd(e) {
    // 두 손가락 탭 → 줌아웃
    if (e.changedTouches.length === 2 && state.get('zoom').phase === 'landed') {
      state.setState({ zoom: { ...state.get('zoom'), phase: 'zooming-out', progress: 0 } });
      return;
    }

    // 더블탭 감지 → 줌아웃
    const now = Date.now();
    if (now - this._lastTouchEndTime < DOUBLE_TAP_MS && state.get('zoom').phase === 'landed') {
      state.setState({ zoom: { ...state.get('zoom'), phase: 'zooming-out', progress: 0 } });
    }
    this._lastTouchEndTime = now;

    state.setState({
      input: { ...state.get('input'), isDragging: false },
    });

    this._scheduleAutoRotate();
  }

  // ── Keyboard ───────────────────────────────────────────────

  _onKeyDown(e) {
    if (e.key === 'Escape' && state.get('zoom').phase === 'landed') {
      state.setState({ zoom: { ...state.get('zoom'), phase: 'zooming-out', progress: 0 } });
    }
  }

  // ── Resize ─────────────────────────────────────────────────

  _onResize() {
    // SceneManager가 'camera' 구독을 통해 처리하도록
    // resize 이벤트를 상태 변화로 발행
    state.setState({
      camera: {
        ...state.get('camera'),
        _resizeSignal: performance.now(), // 고유 타임스탬프로 변경 감지
      },
    });
  }

  // ── Helpers ────────────────────────────────────────────────

  /** 현재 zoom phase가 'idle'인지 확인 */
  _isIdle() {
    return state.get('zoom').phase === 'idle';
  }

  _clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  _getPinchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _scheduleAutoRotate() {
    this._cancelAutoRotateTimer();
    this._autoRotateTimer = setTimeout(() => {
      state.setPath('camera.autoRotate', true);
    }, AUTO_ROTATE_DELAY_MS);
  }

  _cancelAutoRotateTimer() {
    if (this._autoRotateTimer !== null) {
      clearTimeout(this._autoRotateTimer);
      this._autoRotateTimer = null;
    }
  }

  /**
   * 이벤트 리스너를 등록하고 참조를 보관합니다 (destroy 시 정리).
   */
  _on(target, type, handler, options = false) {
    target.addEventListener(type, handler, options);
    this._listeners.push({ target, type, handler, options });
  }
}

export default InputManager;
