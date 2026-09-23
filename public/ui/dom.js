const rendered = new WeakMap();

/**
 * Replaces an element's markup only when it changed, keeping what the person was doing:
 * focus, open/closed <details>, and scroll positions (sticky-to-bottom for live logs).
 */
export function patch(element, markup, { document = globalThis.document } = {}) {
  const text = String(markup);
  if (rendered.get(element) === text) return false;
  const focusKey = document?.activeElement?.dataset?.focusKey;
  const open = new Map([...element.querySelectorAll('details[data-key]')].map((node) => [node.dataset.key, node.open]));
  const scroll = new Map([...element.querySelectorAll('[data-scroll]')].map((node) => [node.dataset.scroll, {
    top: node.scrollTop, atBottom: node.scrollHeight - node.scrollTop - node.clientHeight < 24
  }]));
  element.innerHTML = text;
  rendered.set(element, text);
  for (const node of element.querySelectorAll('details[data-key]')) if (open.has(node.dataset.key)) node.open = open.get(node.dataset.key);
  for (const node of element.querySelectorAll('[data-scroll]')) {
    const previous = scroll.get(node.dataset.scroll);
    if (Object.hasOwn(node.dataset, 'stick') && (!previous || previous.atBottom)) node.scrollTop = node.scrollHeight;
    else if (previous) node.scrollTop = previous.top;
  }
  if (focusKey) [...element.querySelectorAll('[data-focus-key]')].find((node) => node.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
  return true;
}
