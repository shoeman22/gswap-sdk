export {};

declare global {
  interface Window {
    global?: Window;
  }
}

window.global ??= window;
