import type { IslandStatus } from "../types";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../utils/env";

export class IslandController {
  private static readonly SNAP_THRESHOLD = 88;
  private static readonly CLICK_BOUNCE_CLASS = "click-bounce";
  private static readonly DRAG_THRESHOLD = 6;

  private island: HTMLElement;
  private pill: HTMLElement;
  private statusIndicator: HTMLElement;
  private statusText: HTMLElement;
  private isExpanded = false;
  private dragOffset = { x: 0, y: 0 };
  private isDragging = false;
  private isTauriWindow = false;
  private pendingPointerDown: { x: number; y: number } | null = null;

  constructor() {
    this.island = document.getElementById("island") as HTMLElement;
    this.pill = document.querySelector(".island-pill") as HTMLElement;
    this.statusIndicator = document.getElementById("status-indicator") as HTMLElement;
    this.statusText = document.getElementById("status-text") as HTMLElement;
    this.detectTauriWindow();
    this.initDrag();
    this.initClickFeedback();
    void this.syncWindowFrame();
  }

  expand(): void {
    if (this.isExpanded) return;
    this.isExpanded = true;
    this.pill.classList.add("expanded");
    this.island.classList.add("expanded");
    document.body.dataset.expanded = "true";
    void this.syncWindowFrame();
  }

  collapse(): void {
    if (!this.isExpanded) return;
    this.isExpanded = false;
    this.pill.classList.remove("expanded");
    this.island.classList.remove("expanded");
    delete document.body.dataset.expanded;
    void this.syncWindowFrame();
  }

  toggle(): void {
    if (this.isExpanded) {
      this.collapse();
    } else {
      this.expand();
    }
  }

  setStatus(status: IslandStatus, text: string): void {
    document.body.dataset.status = status;
    this.pill.dataset.status = status;

    // Update indicator dot
    this.statusIndicator.className = `status-indicator ${status}`;

    // Update badge in expanded view
    const badge = document.getElementById("status-badge");
    if (badge) {
      badge.className = `status-badge ${status}`;
      badge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    }

    // Animate text transition
    this.statusText.classList.add("status-text-transition-out");
    setTimeout(() => {
      this.statusText.textContent = text;
      this.statusText.classList.remove("status-text-transition-out");
      this.statusText.classList.add("status-text-transition-in");
      setTimeout(() => {
        this.statusText.classList.remove("status-text-transition-in");
      }, 150);
    }, 150);

    // Toggle working glow
    if (status === "working") {
      this.pill.classList.add("working");
    } else {
      this.pill.classList.remove("working");
    }
  }

  setIdle(): void {
    this.setStatus("idle", "Idle");
  }

  setWorking(): void {
    this.setStatus("working", "Working...");
  }

  setWaiting(): void {
    this.setStatus("waiting", "Waiting...");
  }

  setDone(): void {
    this.setStatus("done", "Done");
  }

  setError(): void {
    this.setStatus("error", "Error");
  }

  isExpandedState(): boolean {
    return this.isExpanded;
  }

  private initDrag(): void {
    this.pill.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement;
      if (this.isInteractiveTarget(target)) {
        return;
      }

      this.pendingPointerDown = { x: e.clientX, y: e.clientY };
    });

    document.addEventListener("mousemove", (e) => {
      if (this.pendingPointerDown) {
        const deltaX = e.clientX - this.pendingPointerDown.x;
        const deltaY = e.clientY - this.pendingPointerDown.y;
        const distance = Math.hypot(deltaX, deltaY);

        if (distance >= IslandController.DRAG_THRESHOLD) {
          if (this.isTauriWindow) {
            this.pendingPointerDown = null;
            void this.startNativeWindowDrag();
            return;
          }

          this.beginDomDrag(this.pendingPointerDown.x, this.pendingPointerDown.y);
          this.pendingPointerDown = null;
        }
      }

      if (!this.isDragging) return;
      this.island.classList.add("floating");
      this.island.style.left = `${e.clientX - this.dragOffset.x}px`;
      this.island.style.top = `${e.clientY - this.dragOffset.y}px`;
    });

    document.addEventListener("mouseup", () => {
      this.pendingPointerDown = null;
      if (this.isDragging) {
        this.isDragging = false;
        this.island.style.cursor = "default";
        this.snapDomIslandIfNeeded();
      }
    });
  }

  private initClickFeedback(): void {
    this.pill.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (this.isInteractiveTarget(target)) {
        return;
      }

      this.triggerClickBounce();
    });
  }

  private beginDomDrag(clientX: number, clientY: number): void {
    this.isDragging = true;
    const rect = this.island.getBoundingClientRect();
    this.dragOffset.x = clientX - rect.left;
    this.dragOffset.y = clientY - rect.top;
    this.island.style.cursor = "grabbing";
  }

  private triggerClickBounce(): void {
    this.pill.classList.remove(IslandController.CLICK_BOUNCE_CLASS);
    this.island.classList.remove(IslandController.CLICK_BOUNCE_CLASS);

    // Force reflow so repeated clicks can retrigger the animation immediately.
    void this.pill.offsetWidth;

    this.pill.classList.add(IslandController.CLICK_BOUNCE_CLASS);
    this.island.classList.add(IslandController.CLICK_BOUNCE_CLASS);

    window.setTimeout(() => {
      this.pill.classList.remove(IslandController.CLICK_BOUNCE_CLASS);
      this.island.classList.remove(IslandController.CLICK_BOUNCE_CLASS);
    }, 320);
  }

  private isInteractiveTarget(target: HTMLElement): boolean {
    return Boolean(
      target.tagName === "BUTTON" ||
      target.closest(".approval-buttons") ||
      target.closest(".selection-panel") ||
      target.closest(".settings-panel") ||
      target.closest(".settings-button") ||
      target.closest(".quit-button") ||
      target.closest(".operation-insight") ||
      target.closest(".history-item-link") ||
      target.closest(".status-signal-card") ||
      target.closest(".island-expand-hint")
    );
  }

  private detectTauriWindow(): void {
    this.isTauriWindow = isTauri();
  }

  private snapDomIslandIfNeeded(): void {
    const top = Number.parseFloat(this.island.style.top || "0");
    if (top > IslandController.SNAP_THRESHOLD) return;

    this.island.classList.remove("floating");
    this.island.style.left = "";
    this.island.style.top = "";
  }

  private async startNativeWindowDrag(): Promise<void> {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      await appWindow.startDragging();
      await this.snapNativeWindowIfNeeded();
    } catch (error) {
      console.error("Failed to start native window drag:", error);
    }
  }

  private async snapNativeWindowIfNeeded(): Promise<void> {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      const position = await appWindow.outerPosition();
      const scaleFactor = await appWindow.scaleFactor();
      const logicalTop = position.y / scaleFactor;

      if (logicalTop > IslandController.SNAP_THRESHOLD) {
        return;
      }

      await invoke("snap_island_window");
    } catch (error) {
      console.error("Failed to snap native window:", error);
    }
  }

  private async syncWindowFrame(): Promise<void> {
    if (!this.isTauriWindow) {
      return;
    }

    try {
      await invoke("sync_island_window", { expanded: this.isExpanded });
    } catch (error) {
      console.error("Failed to sync island window frame:", error);
    }
  }
}
