import { html } from './html.js';

/**
 * Modal confirmation built on <dialog>. Resolves with the textarea value (or true) on confirm,
 * and with null when cancelled with the button, Esc or a backdrop click.
 */
export function ask(dialog, { title, body, confirm, tone = 'primary', input, checkbox }) {
  const field = input?.type === 'password'
    ? html`<input type="password" name="value" autocomplete="off" spellcheck="false" placeholder="${input.placeholder ?? ''}" required>`
    : html`<textarea name="value" rows="5" maxlength="${input?.maxLength ?? 4000}" placeholder="${input?.placeholder ?? ''}" required></textarea>`;
  dialog.innerHTML = String(html`<form method="dialog" class="dialog-form">
    <h2>${title}</h2>
    <div class="dialog-body">${body}</div>
    ${input ? html`<label class="field"><span>${input.label}</span>${field}</label>` : ''}
    ${checkbox ? html`<label class="check"><input type="checkbox" name="checked"> <span>${checkbox.label}</span></label>` : ''}
    <div class="toolbar dialog-actions">
      <button type="button" data-cancel class="quiet">Cancelar</button>
      <button value="confirm" class="${tone}">${confirm}</button>
    </div>
  </form>`);
  return new Promise((resolve) => {
    const form = dialog.querySelector('form');
    // Cancel is type=button so Enter in a field submits the confirm button, not the first one in the form.
    const onClick = (event) => { if (event.target === dialog || event.target.closest('[data-cancel]')) dialog.close('cancel'); };
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('close', () => {
      dialog.removeEventListener('click', onClick);
      if (dialog.returnValue !== 'confirm') return resolve(null);
      const value = input ? form.elements.value.value.trim() : true;
      resolve(checkbox ? { value, checked: form.elements.checked.checked } : value);
    }, { once: true });
    dialog.returnValue = '';
    dialog.showModal();
    (form.elements.value ?? form.querySelector('button[value=confirm]')).focus();
  });
}
