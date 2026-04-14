import type { CharacterManifest, CharacterState, AnimationDef } from "../types";

export type TransitionType = "squish" | "jump" | "shake" | "sleep" | undefined;

export class CharacterRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private spritesheet: HTMLImageElement | null = null;
  private manifest: CharacterManifest | null = null;
  private currentFrame = 0;
  private currentAnimation: CharacterState = "idle";
  private animationTimer = 0;
  private lastTimestamp = 0;
  private animFrameId = 0;
  private pingPongForward = true;
  /** Dirty flag — only repaint when the displayed frame actually changed. */
  private dirty = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D context");
    this.ctx = ctx;
    // Set once — no need to reassign every frame.
    this.ctx.imageSmoothingEnabled = false;
  }

  setSpritesheet(spritesheet: HTMLImageElement, manifest: CharacterManifest): void {
    this.spritesheet = spritesheet;
    this.manifest = manifest;
    this.currentFrame = 0;
    this.currentAnimation = manifest.defaultState;
    this.pingPongForward = true;
    this.dirty = true;
  }

  playAnimation(state: CharacterState, transition?: TransitionType): void {
    if (!this.manifest) return;

    this.currentAnimation = state;
    this.currentFrame = 0;
    this.pingPongForward = true;
    this.dirty = true;

    // Apply CSS transition to canvas container
    const container = this.canvas.parentElement;
    if (container && transition) {
      container.classList.remove("transition-squish", "transition-jump", "transition-shake", "transition-sleep");
      // Force reflow
      void container.offsetWidth;
      container.classList.add(`transition-${transition}`);
      container.addEventListener("animationend", () => {
        container.classList.remove(`transition-${transition}`);
      }, { once: true });
    }
  }

  startRenderLoop(): void {
    this.lastTimestamp = performance.now();
    const loop = (timestamp: number) => {
      const delta = timestamp - this.lastTimestamp;
      this.lastTimestamp = timestamp;
      this.update(delta);
      this.render();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  stopRenderLoop(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }
  }

  private update(deltaMs: number): void {
    if (!this.manifest) return;

    const anim = this.manifest.animations[this.currentAnimation];
    if (!anim) return;

    const frameDuration = 1000 / anim.frameRate;
    this.animationTimer += deltaMs;

    if (this.animationTimer >= frameDuration) {
      this.animationTimer -= frameDuration;
      this.advanceFrame(anim);
    }
  }

  private advanceFrame(anim: AnimationDef): void {
    const prevFrame = this.currentFrame;

    if (anim.pingPong) {
      if (this.pingPongForward) {
        this.currentFrame++;
        if (this.currentFrame >= anim.frameCount - 1) {
          this.pingPongForward = false;
        }
      } else {
        this.currentFrame--;
        if (this.currentFrame <= 0) {
          this.pingPongForward = true;
        }
      }
    } else {
      this.currentFrame++;
      if (this.currentFrame >= anim.frameCount) {
        if (anim.loop) {
          this.currentFrame = 0;
        } else {
          this.currentFrame = anim.frameCount - 1;
          // Non-looping animation ended - would trigger nextState
          // via state machine, not here
        }
      }
    }

    if (this.currentFrame !== prevFrame) {
      this.dirty = true;
    }
  }

  private render(): void {
    if (!this.dirty) return;
    this.dirty = false;

    if (!this.spritesheet || !this.manifest) return;

    const anim = this.manifest.animations[this.currentAnimation];
    if (!anim) return;

    const fw = this.manifest.frameWidth;
    const fh = this.manifest.frameHeight;
    const srcX = this.currentFrame * fw;
    const srcY = anim.row * fh;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.drawImage(
      this.spritesheet,
      srcX, srcY, fw, fh,
      0, 0, this.canvas.width, this.canvas.height
    );
  }
}
