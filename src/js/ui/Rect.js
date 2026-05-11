/**
 * Lightweight rectangle utility for layout calculations.
 */
export default class Rect {
  constructor(x = 0, y = 0, w = 0, h = 0) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  clone() {
    return new Rect(this.x, this.y, this.w, this.h);
  }

  copy(other) {
    this.x = other.x;
    this.y = other.y;
    this.w = other.w;
    this.h = other.h;
    return this;
  }

  containsPoint(px, py) {
    return px >= this.x && px <= this.x + this.w &&
           py >= this.y && py <= this.y + this.h;
  }

  intersects(other) {
    return !(other.x > this.x + this.w ||
             other.x + other.w < this.x ||
             other.y > this.y + this.h ||
             other.y + other.h < this.y);
  }

  inflate(dx, dy) {
    this.x -= dx;
    this.y -= dy;
    this.w += dx * 2;
    this.h += dy * 2;
    return this;
  }

  /** Right edge */
  get right() { return this.x + this.w; }
  /** Bottom edge */
  get bottom() { return this.y + this.h; }

  toString() {
    return `Rect(x=${this.x}, y=${this.y}, w=${this.w}, h=${this.h})`;
  }
}
