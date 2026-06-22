// Unified input: keyboard movement, pointer drag-to-orbit vs tap-to-move
// disambiguation, and wheel zoom. The Town reads `keys` each frame and
// subscribes to onTap / camera deltas.

const DRAG_THRESHOLD = 6; // px of movement before a press counts as a drag

export class Input {
  constructor(domElement) {
    this.el = domElement;
    this.keys = new Set();
    this.dragYaw = 0;   // accumulated yaw delta, consumed by Town each frame
    this.dragPitch = 0;
    this.zoomDelta = 0; // accumulated wheel, consumed each frame
    this._tapHandlers = [];

    this._down = false;
    this._dragging = false;
    this._startX = 0;
    this._startY = 0;
    this._lastX = 0;
    this._lastY = 0;

    this._bind();
  }

  onTap(fn) { this._tapHandlers.push(fn); }

  _bind() {
    addEventListener('keydown', (e) => {
      // Ignore when typing into form fields.
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    const el = this.el;
    el.addEventListener('pointerdown', (e) => {
      this._down = true;
      this._dragging = false;
      this._startX = this._lastX = e.clientX;
      this._startY = this._lastY = e.clientY;
      el.setPointerCapture?.(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!this._down) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      if (!this._dragging) {
        const moved = Math.hypot(e.clientX - this._startX, e.clientY - this._startY);
        if (moved > DRAG_THRESHOLD) this._dragging = true;
      }
      if (this._dragging) {
        this.dragYaw -= dx * 0.005;
        this.dragPitch -= dy * 0.003;
      }
    });

    const endPointer = (e) => {
      if (!this._down) return;
      this._down = false;
      el.releasePointerCapture?.(e.pointerId);
      if (!this._dragging) {
        // It was a tap — emit normalized device coords for raycasting.
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

  // Camera-relative movement vector from WASD / arrows. Returns {x, z} in the
  // range [-1, 1] each, NOT normalized (Town normalizes after rotating).
  moveAxis() {
    let x = 0, z = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) z -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) z += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    return { x, z };
  }

  // Consume accumulated camera deltas (call once per frame).
  takeCameraDelta() {
    const out = { yaw: this.dragYaw, pitch: this.dragPitch, zoom: this.zoomDelta };
    this.dragYaw = 0; this.dragPitch = 0; this.zoomDelta = 0;
    return out;
  }
}
