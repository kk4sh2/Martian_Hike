export const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T;
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export function openModal(html: string): HTMLElement {
  const m = $('#modal'); const body = $('.modalBody', m); body.innerHTML = html; m.hidden = false;
  ($('.close', m) as HTMLButtonElement).onclick = closeModal;
  m.onclick = (e) => { if (e.target === m) closeModal(); };
  return body;
}
export function closeModal() { $('#modal').hidden = true; $('.modalBody', $('#modal')).innerHTML = ''; }
export function card(id: string, title: string, tag: string, body: string, collapsed = false) {
  return `<section class="card${collapsed ? ' collapsed' : ''}" id="${id}"><h3>${title}${tag}</h3><div class="body">${body}</div></section>`;
}
export const fmtM = (m: number | null | undefined) => (m === null || m === undefined ? '—' : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`);
export const fmtH = (s: number) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return `${h} h ${String(m).padStart(2, '0')} min`; };
