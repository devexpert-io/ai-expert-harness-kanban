import { html } from './html.js';

/**
 * Modal confirmation built on <dialog>. Resolves with the textarea value (or true) on confirm,
 * and with null when cancelled with the button, Esc or a backdrop click.
 */
export function ask(dialog, { title, body, confirm, tone = 'primary', input }) {
  dialog.innerHTML = String(html`<form method="dialog" class="dialog-form">
    <h2>${title}</h2>
    <div class="dialog-body">${body}</div>
    ${input ? html`<label class="field"><span>${input.label}</span><textarea name="value" rows="5" maxlength="${input.maxLength ?? 4000}" placeholder="${input.placeholder ?? ''}" required></textarea></label>` : ''}
    <div class="toolbar dialog-actions">
      <button value="cancel" formnovalidate class="quiet">Cancelar</button>
      <button value="confirm" class="${tone}">${confirm}</button>
    </div>
  </form>`);
  return new Promise((resolve) => {
    const form = dialog.querySelector('form');
    const onClick = (event) => { if (event.target === dialog) dialog.close('cancel'); };
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('close', () => {
      dialog.removeEventListener('click', onClick);
      if (dialog.returnValue !== 'confirm') return resolve(null);
      resolve(input ? form.elements.value.value.trim() : true);
    }, { once: true });
    dialog.returnValue = '';
    dialog.showModal();
    (form.elements.value ?? form.querySelector('button[value=confirm]')).focus();
  });
}
