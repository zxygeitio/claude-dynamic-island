import type { CharacterState, CharacterManifest } from "../types";

type StateChangeListener = (state: CharacterState, transition?: string) => void;

export class CharacterStateMachine {
  private currentState: CharacterState = "idle";
  private manifest: CharacterManifest | null = null;
  private listeners: StateChangeListener[] = [];
  private nextStateTimer: ReturnType<typeof setTimeout> | null = null;

  setManifest(manifest: CharacterManifest): void {
    this.manifest = manifest;
    this.currentState = manifest.defaultState;
  }

  getCurrentState(): CharacterState {
    return this.currentState;
  }

  transition(newState: CharacterState, transitionType?: string): void {
    if (this.currentState === newState) return;

    // Cancel any pending nextState timer
    if (this.nextStateTimer) {
      clearTimeout(this.nextStateTimer);
      this.nextStateTimer = null;
    }

    this.currentState = newState;

    // Notify listeners
    for (const listener of this.listeners) {
      listener(newState, transitionType);
    }

    // Schedule automatic transitions for non-looping states
    this.scheduleAutoTransition(newState);
  }

  onStateChange(listener: StateChangeListener): void {
    this.listeners.push(listener);
  }

  removeStateChangeListener(listener: StateChangeListener): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  private scheduleAutoTransition(state: CharacterState): void {
    if (!this.manifest) return;

    const anim = this.manifest.animations[state];
    if (!anim || anim.loop) return;

    const hasAnextState = anim.nextState;
    if (!hasAnextState) return;

    const durationMs = (anim.frameCount / anim.frameRate) * 1000;
    const transitionDelay = state === "celebrating" ? 3000 :
                            state === "confused" ? 2000 :
                            durationMs;

    this.nextStateTimer = setTimeout(() => {
      this.transition(hasAnextState);
    }, transitionDelay);
  }
}
