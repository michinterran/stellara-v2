/**
 * StellaraState — 전역 상태 관리 싱글톤 (Observer Pattern)
 *
 * 책임:
 *   - 애플리케이션의 유일한 진실 원천(Single Source of Truth)
 *   - 상태 변경을 추적하고 구독자에게 알림 (Pub/Sub)
 *   - window 객체 오염 없이 모든 전역 상태를 캡슐화
 *
 * 사용법:
 *   import { state } from './StellaraState.js';
 *   state.setState({ zoomPhase: 'zooming-in' });
 *   const unsub = state.subscribe('zoomPhase', (val) => console.log(val));
 *   unsub(); // 구독 해제
 */

// ── 초기 상태 정의 ─────────────────────────────────────────
const INITIAL_STATE = {

  // ─ 렌더링 / 카메라 ───────────────────────────────────────
  camera: {
    spherical: { theta: 0, phi: Math.PI / 2 - 0.08 },
    targetSpherical: { theta: 0, phi: Math.PI / 2 - 0.08 },
    distance: 130,
    targetDistance: 130,
    fov: 58,
    autoRotate: true,
    autoRotateTimer: null,
  },

  // ─ 입력 ──────────────────────────────────────────────────
  input: {
    pointer: { x: -9, y: -9 },      // NDC 좌표 (-1 ~ 1)
    isDragging: false,
    prevPointer: { x: 0, y: 0 },    // 드래그 델타 계산용
    lastTouchTime: 0,
  },

  // ─ 씬 줌 상태 머신 ────────────────────────────────────────
  // 'idle' | 'zooming-in' | 'landed' | 'zooming-out'
  zoom: {
    phase: 'idle',
    progress: 0,
    targetPlanetIndex: null,         // 현재 줌 대상 행성 인덱스
    // 카메라 보간용 스냅샷 (zooming 시작 시 캡처)
    camStart: { x: 0, y: 0, z: 0 },
    camEnd:   { x: 0, y: 0, z: 0 },
    lookStart: { x: 0, y: 0, z: 0 },
    lookEnd:  { x: 0, y: 0, z: 0 },
  },

  // ─ 오디오 / 플레이어 ──────────────────────────────────────
  audio: {
    isPlaying: false,
    currentTrack: {
      title: '새벽의 끝자락',
      artist: 'Stellara 큐레이션 · 몽환 무드',
      duration: 252,   // 초
      progress: 107,   // 초
      discColor: 'rgba(201,123,240,.6)',
      hex: '#C97BF0',
    },
    platform: 'apple_music',  // 'apple_music' | 'youtube_music'
  },

  // ─ UI ────────────────────────────────────────────────────
  ui: {
    hoveredPlanetIndex: null,
    tooltipVisible: false,
    heroVisible: true,
    playerVisible: true,
    planetInfoVisible: false,
    loadingComplete: false,
  },
};

// ── StellaraState 클래스 ────────────────────────────────────
class StellaraState {
  constructor() {
    if (StellaraState._instance) {
      return StellaraState._instance;
    }
    StellaraState._instance = this;

    // 깊은 복사로 초기 상태 설정
    this._state = this._deepClone(INITIAL_STATE);

    // 구독자 맵: { 'keyPath' => Set<callback> }
    this._subscribers = new Map();

    // 상태 변경 히스토리 (개발 환경에서 디버깅용)
    this._history = [];
    this._debug = false;
  }

  /**
   * 현재 상태의 특정 경로 값을 반환합니다.
   * @param {string} keyPath - 점 표기법 경로 (예: 'zoom.phase', 'audio.currentTrack.title')
   * @returns {*} 해당 경로의 값
   */
  get(keyPath) {
    return this._resolvePath(this._state, keyPath);
  }

  /**
   * 상태를 갱신합니다. 중첩 객체는 얕은 병합(shallow merge)됩니다.
   * 최상위 키를 기준으로 구독자에게 알립니다.
   * @param {Object} partial - 갱신할 상태 조각 (최상위 키 기준)
   */
  setState(partial) {
    const prevState = this._state;
    const changedKeys = [];

    for (const topKey of Object.keys(partial)) {
      if (!(topKey in this._state)) {
        console.warn(`[StellaraState] 알 수 없는 상태 키: "${topKey}"`);
        continue;
      }

      const prev = this._state[topKey];
      const next = partial[topKey];

      // 객체이면 얕은 병합, 아니면 직접 대입
      if (typeof prev === 'object' && prev !== null && !Array.isArray(prev)) {
        this._state[topKey] = { ...prev, ...next };
      } else {
        this._state[topKey] = next;
      }

      changedKeys.push(topKey);
    }

    if (this._debug) {
      this._history.push({ timestamp: performance.now(), changed: changedKeys, partial });
    }

    // 변경된 최상위 키에 대해 구독자 알림
    for (const key of changedKeys) {
      this._notify(key, this._state[key]);
    }
  }

  /**
   * 중첩 경로를 직접 갱신합니다 (예: 'zoom.progress').
   * 구독 알림은 최상위 키 기준으로 발생합니다.
   * @param {string} keyPath - 점 표기법 경로
   * @param {*} value - 새 값
   */
  setPath(keyPath, value) {
    const keys = keyPath.split('.');
    const topKey = keys[0];

    if (keys.length === 1) {
      this.setState({ [topKey]: value });
      return;
    }

    // 중첩 참조를 따라가 값을 설정
    let ref = this._state[topKey];
    for (let i = 1; i < keys.length - 1; i++) {
      ref = ref[keys[i]];
    }
    ref[keys[keys.length - 1]] = value;

    // 최상위 키로 구독자 알림
    this._notify(topKey, this._state[topKey]);
  }

  /**
   * 특정 최상위 키의 변경을 구독합니다.
   * @param {string} topKey - 구독할 최상위 상태 키 (예: 'zoom', 'audio')
   * @param {Function} callback - (newValue, topKey) => void
   * @returns {Function} 구독 해제 함수 (unsubscribe)
   */
  subscribe(topKey, callback) {
    if (!this._subscribers.has(topKey)) {
      this._subscribers.set(topKey, new Set());
    }
    this._subscribers.get(topKey).add(callback);

    // 즉시 현재 값으로 한 번 호출 (초기 동기화)
    callback(this._state[topKey], topKey);

    // 구독 해제 함수 반환
    return () => {
      const subs = this._subscribers.get(topKey);
      if (subs) subs.delete(callback);
    };
  }

  /**
   * 여러 키를 한 번에 구독합니다.
   * @param {string[]} keys - 구독할 키 배열
   * @param {Function} callback - (newValue, key) => void
   * @returns {Function} 모든 구독을 해제하는 함수
   */
  subscribeMulti(keys, callback) {
    const unsubs = keys.map(key => this.subscribe(key, callback));
    return () => unsubs.forEach(fn => fn());
  }

  /**
   * 디버그 모드를 활성화합니다 (상태 변경 히스토리 기록).
   */
  enableDebug() {
    this._debug = true;
    console.info('[StellaraState] 디버그 모드 활성화');
  }

  /**
   * 상태 변경 히스토리를 반환합니다.
   */
  getHistory() {
    return this._history;
  }

  // ── Private Methods ───────────────────────────────────────

  _notify(topKey, newValue) {
    const subs = this._subscribers.get(topKey);
    if (!subs || subs.size === 0) return;
    for (const cb of subs) {
      try {
        cb(newValue, topKey);
      } catch (err) {
        console.error(`[StellaraState] 구독자 오류 (key: ${topKey}):`, err);
      }
    }
  }

  _resolvePath(obj, path) {
    return path.split('.').reduce((acc, key) => {
      return acc !== undefined && acc !== null ? acc[key] : undefined;
    }, obj);
  }

  _deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
}

// ── 싱글톤 인스턴스 내보내기 ──────────────────────────────
export const state = new StellaraState();
export default StellaraState;
