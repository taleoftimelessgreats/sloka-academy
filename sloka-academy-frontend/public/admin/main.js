// Entry point: the router and boot.
// Rendered with DOM APIs / textContent only. Never use innerHTML with data.

import { viewAccount, viewLogin, viewFirstPassword } from './account.js';
import { viewAssociateDetail, viewAssociates } from './associates.js';
import { viewAudit } from './audit.js';
import { viewCertificateDetail, viewCertificates, viewSessionDetail, viewSessionForm, viewSessions } from './certificates.js';
import { $app, ApiError, api, canAny, ensureMeta, errorText, go, h, mount, onNavigate, parseHash, renderChrome, state } from './core.js';
import { viewDetail, viewList, viewNew } from './enquiries.js';
import { viewOverview } from './overview.js';
import { viewFlags, viewRegistrationForm, viewRegistrations, viewStudentRegistrations } from './registrations.js';
import { viewRoles } from './roles.js';
import { viewOfferTemplateEditor, viewSettings, viewTemplateEditor } from './settings.js';
import { viewStudentDetail, viewStudents, viewVerifications } from './students.js';

// [path pattern, permissions (any one will do), view(match, params, stale)]. The API checks permissions again.
const ROUTES = [
  [/^\/$/, null, (m, p, stale) => viewOverview(stale)],
  [/^\/registrations$/, ['registrations.view'], (m, p, stale) => viewRegistrations(p, stale)],
  [/^\/registrations\/new$/, ['registrations.create'], (m, p, stale) => viewRegistrationForm(stale)],
  [/^\/registrations\/flags$/, ['students.edit'], (m, p, stale) => viewFlags(p, stale)],
  [/^\/registrations\/students\/(\d+)$/, ['registrations.view'], (m, p, stale) => viewStudentRegistrations(Number(m[1]), p, stale)],
  [/^\/enquiries$/, ['enquiries.view'], (m, p, stale) => viewList(p, stale)],
  [/^\/enquiries\/(\d+)$/, ['enquiries.view'], (m, p, stale) => viewDetail(Number(m[1]), stale)],
  [/^\/new$/, ['enquiries.create'], (m, p, stale) => viewNew(stale)],
  [/^\/sessions$/, ['sessions.view'], (m, p, stale) => viewSessions(stale)],
  [/^\/sessions\/new$/, ['sessions.create'], (m, p, stale) => viewSessionForm(null, stale)],
  [/^\/sessions\/(\d+)\/edit$/, ['sessions.edit'], (m, p, stale) => viewSessionForm(Number(m[1]), stale)],
  [/^\/sessions\/(\d+)$/, ['sessions.view'], (m, p, stale) => viewSessionDetail(Number(m[1]), p, stale)],
  [/^\/certificates$/, ['certificates.view'], (m, p, stale) => viewCertificates(p, stale)],
  [/^\/certificates\/(\d+)$/, ['certificates.view'], (m, p, stale) => viewCertificateDetail(Number(m[1]), stale)],
  [/^\/students$/, ['students.view'], (m, p, stale) => viewStudents(p, stale)],
  [/^\/students\/verifications$/, ['students.view'], (m, p, stale) => viewVerifications(p, stale)],
  [/^\/students\/(\d+)$/, ['students.view'], (m, p, stale) => viewStudentDetail(Number(m[1]), stale)],
  [/^\/settings$/, ['settings.view', 'certTemplates.view', 'offerTemplates.view', 'courses.view'], (m, p, stale) => viewSettings(stale)],
  [/^\/settings\/templates\/(\d+)$/, ['certTemplates.edit'], (m, p, stale) => viewTemplateEditor(Number(m[1]), stale)],
  [/^\/settings\/offer-templates\/(\d+)$/, ['offerTemplates.view'], (m, p, stale) => viewOfferTemplateEditor(Number(m[1]), stale)],
  [/^\/associates$/, ['associates.view'], (m, p, stale) => viewAssociates(stale)],
  [/^\/associates\/(\d+)$/, ['associates.view'], (m, p, stale) => viewAssociateDetail(Number(m[1]), stale)],
  [/^\/roles$/, ['roles.view'], (m, p, stale) => viewRoles(stale)],
  [/^\/audit$/, ['audit.view'], (m, p, stale) => viewAudit(p, stale)],
  [/^\/account$/, null, () => viewAccount()],
];

export async function route() {
  const seq = ++state.seq;
  const { path, params } = parseHash();
  if (!state.me && path !== '/login') {
    go('#/login');
    return;
  }
  renderChrome();
  if (path !== state.lastPath) window.scrollTo(0, 0);
  state.lastPath = path;
  const stale = () => seq !== state.seq;
  try {
    if (path === '/login') {
      if (state.me) return go('#/');
      viewLogin();
    } else if (state.me.mustChangePassword) {
      // A temporary password: nothing else until they choose their own.
      viewFirstPassword();
    } else {
      let found = false;
      for (const [pattern, perms, view] of ROUTES) {
        const m = path.match(pattern);
        if (!m) continue;
        found = true;
        if (perms && !canAny(...perms)) mount('Not allowed', h('p', { class: 'muted' }, 'You do not have permission to open this page. Ask a Super Admin if you need it.'));
        else await view(m, params, stale);
        break;
      }
      if (!found) mount('Not found', h('p', { class: 'muted' }, 'Page not found. '), h('a', { href: '#/' }, 'Go to overview'));
    }
    if (!stale() && !$app.contains(document.activeElement)) $app.focus({ preventScroll: true });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    if (stale()) return;
    mount('Error', h('div', { class: 'card' }, h('p', null, errorText(err)), h('a', { href: '#/' }, 'Back to overview')));
  }
}

// ------------------------------------------------------------------ boot

onNavigate(route);

document.getElementById('logout').addEventListener('click', async () => {
  try {
    await api('POST', '/api/auth/logout');
  } catch {
    /* ignore */
  }
  state.me = null;
  state.meta = null;
  renderChrome();
  go('#/login');
});

window.addEventListener('hashchange', route);

(async function boot() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    if (res.ok) {
      state.me = (await res.json()).user;
      if (!state.me.mustChangePassword) await ensureMeta(true);
    }
  } catch {
    /* treated as signed out */
  }
  route();
})();
