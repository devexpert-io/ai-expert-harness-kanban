const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => entities[character]);

class Markup {
  constructor(text) { this.text = text; }
  toString() { return this.text; }
}
const render = (value) => {
  if (Array.isArray(value)) return value.map(render).join('');
  if (value instanceof Markup) return value.text;
  return value === false || value == null ? '' : escapeHtml(value);
};

/** Tagged template: every interpolation is escaped unless it is itself `html` markup. */
export const html = (strings, ...values) => new Markup(strings.reduce((output, string, index) => output + render(values[index - 1]) + string));

export const list = (items) => html`<ul>${items.map((item) => html`<li>${item}</li>`)}</ul>`;
export const shortHash = (hash) => String(hash ?? '').slice(0, 8);
export const clockTime = (value) => new Date(value).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
