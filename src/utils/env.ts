/**
 * Runtime environment utility to check if the application is currently
 * running within a native Tauri window or a standard web browser preview.
 */
export const isTauri = (): boolean => "__TAURI_INTERNALS__" in window;
