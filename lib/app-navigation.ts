// The root router owns internal navigation so transfers survive workspace and account transitions.
export function navigateInRelay(path: string, replace = false) {
  window.dispatchEvent(new CustomEvent("relay-navigate", { detail: { path, replace } }));
}
