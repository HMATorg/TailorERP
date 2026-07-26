/**
 * Print Center mode switch (D-047). Toggles which `.print-only` section
 * `print.css` reveals, sets a matching `@page` size hint for the physical
 * medium, and calls the browser's own print dialog — the only way a web page
 * reaches a printer, thermal or otherwise, without native OS access.
 */
export type PrintMode = 'thermal' | 'tags';

const PAGE_SIZE: Record<PrintMode, string> = {
  // 80mm is the common thermal receipt roll width; height is left to the
  // content, matching how thermal printers actually cut.
  thermal: '80mm auto',
  // A common thermal label size. The OS driver is free to substitute whatever
  // stock is actually loaded — this is a hint, not a hard constraint.
  tags: '62mm 100mm',
};

let styleEl: HTMLStyleElement | null = null;

export function printSection(mode: PrintMode): void {
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'print-center-page-size';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `@page { size: ${PAGE_SIZE[mode]}; margin: 3mm; }`;

  const className = `printing-${mode}`;
  document.body.classList.add(className);

  const cleanup = () => {
    document.body.classList.remove(className);
    window.removeEventListener('afterprint', cleanup);
  };
  // `afterprint` fires on both a completed print and a cancelled dialog in
  // every major browser, so this is the one place cleanup needs to happen.
  window.addEventListener('afterprint', cleanup);

  window.print();
}
