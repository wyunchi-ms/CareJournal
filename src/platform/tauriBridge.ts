/**
 * Tauri desktop platform bridge.
 *
 * Uses the official Tauri v2 __TAURI_INTERNALS__ marker for detection.
 * All @tauri-apps/api sub-modules are lazily imported so they are never
 * bundled or executed in non-desktop (Web / Android / iOS / Harmony) builds.
 */

/** Returns true only when running inside a Tauri v2 WebView. */
export function isTauriPlatform(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
}

/**
 * Invoke a Tauri command. Lazily imports @tauri-apps/api/core so the module
 * is never loaded on non-desktop targets.
 */
export async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

/**
 * Subscribe to a Tauri event. Returns an unlisten function.
 * Lazily imports @tauri-apps/api/event.
 */
export async function tauriListen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event')
  return listen<T>(event, (e) => handler(e.payload))
}

/**
 * Convert an absolute filesystem path to the Tauri asset-protocol URL that
 * the WebView can load directly (e.g. for <img src>).
 *
 * Delegates to window.__TAURI_INTERNALS__.convertFileSrc when present
 * (Tauri v2), then falls back to the same URL construction logic used by
 * @tauri-apps/api/core for environments where the internals object is not
 * yet initialised (e.g. unit tests).
 *
 * This function is intentionally synchronous so storedImageSource() can
 * remain synchronous.
 */
export function tauriConvertFileSrc(path: string): string {
  const internals = typeof window !== 'undefined'
    ? (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ as
        | { convertFileSrc?: (path: string, protocol?: string) => string }
        | undefined
    : undefined
  if (internals?.convertFileSrc) {
    return internals.convertFileSrc(path)
  }
  // Fallback: reconstruct URL using the same logic as @tauri-apps/api/core
  const encoded = encodeURIComponent(path)
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')
    ? `https://asset.localhost/${encoded}`
    : `asset://localhost/${encoded}`
}
