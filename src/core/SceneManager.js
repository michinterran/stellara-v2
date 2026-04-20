/**
 * SceneManager — Three.js 씬·렌더러·카메라 생명주기 관리
 *
 * 책임:
 *   - THREE.WebGLRenderer, Scene, Camera 초기화 및 소멸
 *   - 렌더링 루프(rAF) 오케스트레이션
 *   - StellaraState 구독 → 카메라 상태 반영
 *   - 화면 리사이즈 대응
 *   - 다른 Manager(Planet, Audio 등)를 tick에 연결
 *
 * 규칙:
 *   - animate() 내부에서 new 키워드 사용 금지
 *   - animate() 내부에서 DOM 접근 금지
 *   - 직접 StellaraState를 수정하지 않음 (읽기 전용)
 */

import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
import { state } from './StellaraState.js';

// 보간 상수
const LERP_SPHERICAL = 0.045;
const LERP_DISTANCE  = 0.06;

export class SceneManager {
  /**
   * @param {HTMLElement} container - canvas를 마운트할 부모 요소
   */
  constructor(container) {
    this._container = container;

    // Three.js 핵심 객체
    this.renderer = null;
    this.scene    = null;
    this.camera   = null;
    this.clock    = new THREE.Clock();

    // rAF ID (정지 시 취소)
    this._rafId = null;

    // 카메라 보간용 재사용 벡터 (렌더 루프 내 할당 방지)
    this._camPos   = new THREE.Vector3();
    this._lookAt   = new THREE.Vector3();
    this._zoomLookStart = new THREE.Vector3();
    this._zoomLookEnd   = new THREE.Vector3();
    this._zoomCamStart  = new THREE.Vector3();
    this._zoomCamEnd    = new THREE.Vector3();

    // 외부 tick 핸들러 (PlanetManager 등 연결용)
    this._tickHandlers = [];

    // 구독 해제 함수 목록
    this._unsubs = [];

    this._init();
  }

  // ── Public API ─────────────────────────────────────────────

  /** 외부 Manager의 tick 함수를 렌더 루프에 연결합니다. */
  addTickHandler(fn) {
    this._tickHandlers.push(fn);
  }

  removeTickHandler(fn) {
    this._tickHandlers = this._tickHandlers.filter(h => h !== fn);
  }

  /** 렌더 루프를 시작합니다. */
  start() {
    if (this._rafId !== null) return;
    this.clock.start();
    this._loop();
    console.info('[SceneManager] 렌더 루프 시작');
  }

  /** 렌더 루프를 멈춥니다. */
  stop() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /** 모든 리소스를 해제합니다. */
  destroy() {
    this.stop();
    this._unsubs.forEach(fn => fn());
    this.renderer.dispose();
    this._container.removeChild(this.renderer.domElement);
    console.info('[SceneManager] 리소스 해제 완료');
  }

  // ── Init ───────────────────────────────────────────────────

  _init() {
    const W = window.innerWidth;
    const H = window.innerHeight;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(W, H);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x010006, 1);
    this._container.prepend(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x010006, 0.0028);

    // Camera
    const camState = state.get('camera');
    this.camera = new THREE.PerspectiveCamera(camState.fov, W / H, 0.1, 3000);
    this.camera.position.set(0, 8, 130);

    // StellaraState 구독 — 리사이즈 신호
    const unsubCam = state.subscribe('camera', (camData) => {
      if (camData._resizeSignal) this._onResize();
    });
    this._unsubs.push(unsubCam);

    console.info('[SceneManager] 초기화 완료');
  }

  // ── Render Loop ────────────────────────────────────────────

  _loop() {
    this._rafId = requestAnimationFrame(() => this._loop());
    this._tick();
  }

  _tick() {
    const elapsed = this.clock.getElapsedTime();
    const delta   = this.clock.getDelta();

    // 카메라 상태 처리
    this._updateCamera(elapsed);

    // 외부 tick 핸들러 호출 (PlanetManager, EffectsManager 등)
    for (const handler of this._tickHandlers) {
      handler(elapsed, delta);
    }

    // 렌더
    this.renderer.render(this.scene, this.camera);
  }

  // ── Camera Update ───────────────────────────────────────────

  _updateCamera(elapsed) {
    const camData  = state.get('camera');
    const zoomData = state.get('zoom');

    switch (zoomData.phase) {
      case 'idle':
        this._updateIdleCamera(camData, elapsed);
        break;
      case 'zooming-in':
        this._updateZoomInCamera(zoomData);
        break;
      case 'zooming-out':
        this._updateZoomOutCamera(zoomData);
        break;
      case 'landed':
        this._updateLandedCamera(zoomData, elapsed);
        break;
    }
  }

  _updateIdleCamera(camData, elapsed) {
    // 자동 회전
    if (camData.autoRotate) {
      state.setPath('camera.targetSpherical.theta',
        camData.targetSpherical.theta + 0.00045
      );
    }

    // 구면 좌표 Lerp
    const curTh  = camData.spherical.theta;
    const curPh  = camData.spherical.phi;
    const tarTh  = camData.targetSpherical.theta;
    const tarPh  = camData.targetSpherical.phi;

    const newTh  = curTh + (tarTh - curTh) * LERP_SPHERICAL;
    const newPh  = curPh + (tarPh - curPh) * LERP_SPHERICAL;
    const newDst = camData.distance + (camData.targetDistance - camData.distance) * LERP_DISTANCE;

    // 상태 갱신 (쓰기)
    state.setState({
      camera: {
        ...camData,
        spherical: { theta: newTh, phi: newPh },
        distance: newDst,
      },
    });

    // 카메라 포지션 직접 설정 (재사용 벡터)
    const r = newDst + Math.sin(elapsed * 0.11) * 2.2;
    this._camPos.set(
      r * Math.sin(newPh) * Math.sin(newTh),
      r * Math.cos(newPh),
      r * Math.sin(newPh) * Math.cos(newTh)
    );
    this.camera.position.copy(this._camPos);
    this._lookAt.set(0, 0, 0);
    this.camera.lookAt(this._lookAt);
  }

  _updateZoomInCamera(zoomData) {
    const progress = Math.min(zoomData.progress + 0.016 * 0.55, 1);
    const e = this._easeInOutCubic(progress);

    // 재사용 벡터에 시작/끝 복사
    this._zoomCamStart.set(zoomData.camStart.x, zoomData.camStart.y, zoomData.camStart.z);
    this._zoomCamEnd.set(zoomData.camEnd.x, zoomData.camEnd.y, zoomData.camEnd.z);
    this._zoomLookStart.set(zoomData.lookStart.x, zoomData.lookStart.y, zoomData.lookStart.z);
    this._zoomLookEnd.set(zoomData.lookEnd.x, zoomData.lookEnd.y, zoomData.lookEnd.z);

    this._camPos.lerpVectors(this._zoomCamStart, this._zoomCamEnd, e);
    this._lookAt.lerpVectors(this._zoomLookStart, this._zoomLookEnd, e);
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._lookAt);

    this.camera.fov = 58 + (52 - 58) * this._easeInCubic(progress);
    this.camera.updateProjectionMatrix();

    state.setPath('zoom.progress', progress);

    if (progress >= 1) {
      state.setState({ zoom: { ...zoomData, phase: 'landed', progress: 1 } });
    }
  }

  _updateZoomOutCamera(zoomData) {
    const progress = Math.min(zoomData.progress + 0.016 * 0.5, 1);
    const e = this._easeInOutCubic(progress);

    this._zoomCamStart.set(zoomData.camStart.x, zoomData.camStart.y, zoomData.camStart.z);
    this._zoomCamEnd.set(zoomData.camEnd.x, zoomData.camEnd.y, zoomData.camEnd.z);
    this._zoomLookStart.set(zoomData.lookStart.x, zoomData.lookStart.y, zoomData.lookStart.z);
    this._zoomLookEnd.set(zoomData.lookEnd.x, zoomData.lookEnd.y, zoomData.lookEnd.z);

    this._camPos.lerpVectors(this._zoomCamStart, this._zoomCamEnd, e);
    this._lookAt.lerpVectors(this._zoomLookStart, this._zoomLookEnd, e);
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._lookAt);

    this.camera.fov = 52 + (58 - 52) * this._easeOutCubic(progress);
    this.camera.updateProjectionMatrix();

    state.setPath('zoom.progress', progress);

    if (progress >= 1) {
      state.setState({ zoom: { ...zoomData, phase: 'idle', progress: 0, targetPlanetIndex: null } });
    }
  }

  _updateLandedCamera(zoomData, elapsed) {
    // PlanetManager가 제공하는 행성 위치를 상태에서 읽음
    // (직접 PlanetManager를 참조하지 않는다 — 결합도 최소화)
    const planetPos = zoomData.landedPlanetPosition;
    if (!planetPos) return;

    const radius = zoomData.landedOrbitRadius || 30;
    const angle  = elapsed * 0.18;

    this._camPos.set(
      planetPos.x + Math.sin(angle) * radius,
      planetPos.y + Math.sin(elapsed * 0.08) * 2,
      planetPos.z + Math.cos(angle) * radius
    );
    this._lookAt.set(planetPos.x, planetPos.y, planetPos.z);
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._lookAt);
  }

  // ── Resize ─────────────────────────────────────────────────

  _onResize() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(W, H);
  }

  // ── Easing Helpers ─────────────────────────────────────────

  _easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  _easeInCubic(t) { return t * t * t; }
  _easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
}

export default SceneManager;
