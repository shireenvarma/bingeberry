export function createMobileNavigation(document, view = document.defaultView) {
  const sidebar = document.getElementById('sidebar');
  const trigger = document.querySelector('.mobile-menu');
  const backdrop = document.getElementById('mobile-nav-backdrop');
  const background = [document.querySelector('.app-topbar'), document.getElementById('main-content')];
  const media = view.matchMedia?.('(max-width: 640px)');
  const isMobile = () => media ? media.matches : view.innerWidth <= 640;
  let open = false;
  let inertState = [];

  function close(restoreFocus = true) {
    const wasOpen = open;
    open = false;
    sidebar.classList.remove('mobile-open');
    sidebar.removeAttribute('aria-modal');
    sidebar.removeAttribute('role');
    trigger.setAttribute('aria-expanded', 'false');
    backdrop.hidden = true;
    inertState.forEach(([element, inert]) => element.toggleAttribute('inert', inert));
    inertState = [];
    if (wasOpen && restoreFocus && isMobile()) trigger.focus({ preventScroll: true });
    if (wasOpen && !isMobile()) sidebar.querySelector('.nav-item.active')?.focus({ preventScroll: true });
    if (isMobile()) sidebar.setAttribute('aria-hidden', 'true');
    else sidebar.removeAttribute('aria-hidden');
  }
  function show() {
    if (!isMobile() || open) return;
    open = true;
    sidebar.classList.add('mobile-open');
    sidebar.removeAttribute('aria-hidden');
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-modal', 'true');
    trigger.setAttribute('aria-expanded', 'true');
    backdrop.hidden = false;
    inertState = background.filter(Boolean).map((element) => [element, element.hasAttribute('inert')]);
    background.filter(Boolean).forEach((element) => element.setAttribute('inert', ''));
    sidebar.querySelector('[data-mobile-nav-close]').focus({ preventScroll: true });
  }
  const focusable = () => [...sidebar.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]')]
    .filter((element) => !element.closest('[hidden]') && view.getComputedStyle(element).display !== 'none');
  document.addEventListener('keydown', (event) => {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const items = focusable();
    const index = items.indexOf(document.activeElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus(); }
    else if (!event.shiftKey && (index < 0 || index === items.length - 1)) { event.preventDefault(); items[0]?.focus(); }
  });
  backdrop.addEventListener('click', () => close());
  sidebar.querySelector('[data-mobile-nav-close]').addEventListener('click', () => close());
  const resize = () => close(false);
  if (media?.addEventListener) media.addEventListener('change', resize);
  else view.addEventListener('resize', resize);
  close(false);
  return { toggle: () => open ? close() : show(), close };
}
