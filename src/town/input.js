// Unified input: keyboard movement, pointer drag-to-orbit vs tap-to-move
// disambiguation, wheel zoom, and two-finger pinch zoom on touch. The Town
// reads `keys` each frame and consumes accumulated camera deltas.

const DRAG_THRESHOLD = 6; // px before a press counts as a drag

export class Input {
  constructor(domElement) {
    this.el = domElement;
    this.keys = new Set();
    this.dragYaw = 0;
    this.dragPitch = 0;
    this.zoomDelta = 0;
    this._tapHandlers = [];

    this.pointers = new Map(); // id -> {x, y}
    this._dragging = false;
    this._startX = 0; this._startY = 0;
    this._lastX = 0; this._lastY = 0;
    this._pinchDist = 0;

    this._bind();
  }

  onTap(fn) { this._tapHandlers.push(fn); }

  _bind() {
    addEventListener('keydown', (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    const el = this.el;
    el.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this._dragging = false;
        this._startX = this._lastX = e.clientX;
        this._startY = this._lastY = e.clientY;
      } else {
        this._dragging = true; // multi-touch is never a tap
        this._pinchDist = 0;
      }
      el.setPointerCapture?.(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX; p.y = e.clientY;

      if (this.pointers.size >= 2) {
        const pts = [...this.pointers.values()];
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this._pinchDist) this.zoomDelta += (this._pinchDist - d) * 0.05;
        this._pinchDist = d;
        return;
      }

      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX; this._lastY = e.clientY;
      if (!this._dragging && Math.hypot(e.clientX - this._startX, e.clientY - this._startY) > DRAG_THRESHOLD) {
        this._dragging = true;
      }
      if (this._dragging) {
        this.dragYaw -= dx * 0.005;
        this.dragPitch -= dy * 0.003;
      }
    });

    const endPointer = (e) => {
      const had = this.pointers.delete(e.pointerId);
      el.releasePointerCapture?.(e.pointerId);
      if (this.pointers.size < 2) this._pinchDist = 0;
      if (had && this.pointers.size === 0 && !this._dragging) {
        const rect = el.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        for (const fn of this._tapHandlers) fn(nx, ny);
      }
    };
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomDelta += Math.sign(e.deltaY);
    }, { passive: false });
  }

  moveAxis() {
    let x = 0, z = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) z -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    return { x, z };
  }

  takeCameraDelta() {
    const out = { yaw: this.dragYaw, pitch: this.dragPitch, zoom: this.zoomDelta };
    this.dragYaw = 0; this.dragPitch = 0; this.zoomDelta = 0;
    return out;
  }
}
