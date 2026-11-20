// The overview page.
// Rendered with DOM APIs / textContent only. Never use innerHTML with data.

import { certBadge, emailBadge, sessionBadge } from './certificates.js';
import { api, can, ensureMeta, fmtDate, fmtDateTime, fmtMoney, h, mount, state, statusBadge } from './core.js';

// ------------------------------------------------------------------ view: overview

function conversionTable(title, rows, keyLabel) {
  const table = h(
    'table',
    null,
    h(
      'thead',
      null,
      h('tr', null, h('th', null, keyLabel), h('th', { class: 'num' }, 'Enquiries'), h('th', { class: 'num' }, 'Pre-registered'), h('th', { class: 'num' }, 'Enrolled'), h('th', { class: 'num' }, 'Enrolled %')),
    ),
    h(
      'tbody',
      null,
      rows.length
        ? rows.map((r) =>
            h('tr', null, h('td', null, r.label), h('td', { class: 'num' }, r.total), h('td', { class: 'num' }, r.preRegistered), h('td', { class: 'num' }, r.enrolled), h('td', { class: 'num' }, `${r.enrolledPct}%`)),
          )
        : h('tr', null, h('td', { colspan: '5', class: 'empty' }, 'No enquiries yet.')),
    ),
  );
  return h('section', { class: 'card card-flush' }, h('h2', null, title), h('div', { class: 'table-wrap' }, table));
}

export async function viewOverview(stale) {
  const [s] = await Promise.all([api('GET', '/api/stats'), ensureMeta()]);
  if (stale()) return;
  state.today = s.today;
  // Each section is only in the response (and shown) for those allowed to see it.
  const c = s.certificates;
  const sys = s.system;
  const r = s.registrations;
  const card = (num, lbl, href, hot) =>
    h('a', { class: hot && num > 0 ? 'stat hot' : 'stat', href }, h('div', { class: 'num' }, num), h('div', { class: 'lbl' }, lbl));

  // Things that need someone's attention.
  const alerts = [];
  if (r && r.overdue > 0) {
    alerts.push(h('a', { class: 'alert', href: '#/registrations?view=overdue' }, h('strong', null, `${r.overdue} ${r.overdue === 1 ? 'registration is' : 'registrations are'} overdue.`), ' The balance due date has passed. Follow up →'));
  }
  if (s.openRegistrationFlags > 0) {
    alerts.push(h('a', { class: 'alert alert-warn', href: '#/registrations/flags' }, h('strong', null, `${s.openRegistrationFlags} mobile/email ${s.openRegistrationFlags === 1 ? 'conflict' : 'conflicts'} flagged by associates. `), 'Review →'));
  }
  if (c && c.emailFailed > 0) {
    alerts.push(
      h('a', { class: 'alert', href: '#/certificates?emailStatus=failed' }, h('strong', null, `${c.emailFailed} certificate ${c.emailFailed === 1 ? 'email' : 'emails'} failed.`), ' Open the list to check the addresses and send again.'),
    );
  }
  if (sys && sys.sheet.configured && sys.sheet.lastError) {
    alerts.push(h('a', { class: 'alert', href: '#/settings' }, h('strong', null, 'Google Sheet sync is failing. '), sys.sheet.lastError));
  }
  if (s.pendingVerifications > 0) {
    alerts.push(
      h(
        'a',
        { class: 'alert alert-warn', href: '#/students/verifications' },
        h('strong', null, `${s.pendingVerifications} ${s.pendingVerifications === 1 ? 'registration or enquiry is' : 'registrations or enquiries are'} waiting for profile verification. `),
        'The email or mobile number matches an existing student but other details differ. Review →',
      ),
    );
  }

  const td = (lbl, ...x) => h('td', { 'data-label': lbl }, ...x);
  const recent = s.recentRegistrations;
  const recentCard = recent
    ? h(
        'section',
        { class: 'card card-flush' },
        h('div', { class: 'card-head' }, h('h2', null, 'Latest certificate registrations'), h('a', { class: 'small', href: '#/certificates' }, 'All certificates →')),
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'stackable' },
            h('thead', null, h('tr', null, ['Student', 'Session', 'Certificate', 'Email', 'Registered'].map((t) => h('th', null, t)))),
            h(
              'tbody',
              null,
              recent.length
                ? recent.map((x) =>
                    h(
                      'tr',
                      null,
                      h(
                        'td',
                        { class: 'primary', 'data-label': 'Student' },
                        h('a', { class: 'name', href: `#/certificates/${x.id}` }, x.name),
                        h('span', { class: 'sub' }, x.college),
                        x.studentId ? null : h('span', { class: 'badge', 'data-status': 'verify' }, 'Pending verification'),
                      ),
                      td('Session', x.session.title, h('span', { class: 'sub' }, fmtDate(x.session.sessionDate))),
                      td('Certificate', h('span', { class: 'mono nowrap' }, x.certificateId), x.status === 'revoked' ? certBadge(x.status) : null),
                      td('Email', emailBadge(x.emailStatus)),
                      td('Registered', h('span', { class: 'nowrap' }, fmtDateTime(x.createdAt))),
                    ),
                  )
                : h('tr', null, h('td', { colspan: '5', class: 'empty' }, 'No registrations yet. Create a session, then share its student link.')),
            ),
          ),
        ),
      )
    : null;

  const sessionsCard = s.sessions
    ? h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-head flush' }, h('h2', null, 'Sessions'), h('a', { class: 'small', href: '#/sessions' }, 'All sessions →')),
        s.sessions.length
          ? h(
              'ul',
              { class: 'plain-list' },
              s.sessions.map((x) =>
                h(
                  'li',
                  null,
                  h('div', null, h('a', { class: 'name', href: `#/sessions/${x.id}` }, x.title), h('span', { class: 'sub' }, `${fmtDate(x.sessionDate)} · ${x.mode === 'online' ? 'Online' : x.venue || 'In person'}`)),
                  h('div', { class: 'row' }, sessionBadge(x), h('span', { class: 'muted nowrap' }, `${x.registrations} registered`)),
                ),
              ),
            )
          : h('p', { class: 'muted' }, 'No sessions yet.'),
      )
    : null;

  let systemCard = null;
  if (sys) {
    const statusLine = (name, ok, text, href) =>
      h('div', { class: 'status-line' }, h('span', { class: ok ? 'dot dot-ok' : 'dot dot-off' }), h('span', { class: 'status-name' }, name), href ? h('a', { href }, text) : h('span', { class: 'muted' }, text));
    let sheetText;
    if (!sys.sheet.configured) sheetText = 'No sheet connected yet';
    else if (sys.sheet.lastError) sheetText = 'Sync failing, see Settings';
    else sheetText = sys.sheet.pending ? `${sys.sheet.pending} waiting to sync` : `Up to date${sys.sheet.lastSyncAt ? ` (${fmtDateTime(sys.sheet.lastSyncAt)})` : ''}`;
    systemCard = h(
      'section',
      { class: 'card' },
      h('h2', null, 'Certificate delivery'),
      statusLine('Email to students', sys.emailEnabled, sys.emailEnabled ? 'On: the PDF is emailed on registration' : 'Off: students download only', '#/settings'),
      statusLine('Google Sheet', sys.sheet.configured && !sys.sheet.lastError, sheetText, '#/settings'),
      statusLine('Certificate design', true, sys.defaultTemplate || 'Built-in Sloka design', '#/settings'),
    );
  }

  const enquiriesCard =
    s.total !== undefined
      ? h(
          'a',
          { class: 'card card-link', href: s.newCount ? '#/enquiries?status=new' : '#/enquiries' },
          h('span', null, h('strong', null, 'Internship enquiries'), h('span', { class: 'sub' }, 'Pre-registrations, contact and brochure requests')),
          h('span', { class: s.newCount ? 'badge' : 'muted', 'data-status': s.newCount ? 'new' : null }, s.newCount ? `${s.newCount} new` : `${s.total} total`),
        )
      : null;

  const stats = [
    r ? card(r.thisMonth, 'Registrations this month', '#/registrations', false) : null,
    r ? card(r.dueThisWeek, 'Balances due this week', '#/registrations?view=due-week', true) : null,
    r ? h('a', { class: 'stat', href: '#/registrations' }, h('div', { class: 'num' }, fmtMoney(r.outstanding)), h('div', { class: 'lbl' }, `Outstanding (${fmtMoney(r.collected)} collected)`)) : null,
    s.students !== undefined ? card(s.students, 'Students', '#/students', false) : null,
    c ? card(c.registrationsThisWeek, 'Certificate registrations this week', '#/certificates', false) : null,
    c ? card(c.issuedTotal, 'Certificates issued', '#/certificates', false) : null,
    c ? card(c.openSessions, 'Open sessions', '#/sessions', false) : null,
  ].filter(Boolean);

  mount(
    'Overview',
    h(
      'div',
      { class: 'page-head' },
      h('h1', null, 'Overview'),
      h('span', { class: 'muted' }, fmtDate(s.today)),
      h('span', { class: 'spacer' }),
      can('registrations.create') ? h('a', { class: 'btn btn-primary', href: '#/registrations/new' }, '+ Register a student') : null,
      can('sessions.create') ? h('a', { class: 'btn', href: '#/sessions/new' }, '+ New session') : null,
    ),
    alerts.length ? h('div', { class: 'stack alerts' }, alerts) : null,
    stats.length ? h('div', { class: 'stats' }, stats) : null,
    recentCard || sessionsCard || systemCard || enquiriesCard
      ? h('div', { class: recentCard ? 'detail' : 'stack' }, recentCard, h('div', { class: 'stack' }, sessionsCard, systemCard, enquiriesCard))
      : null,
    !stats.length && !alerts.length && !recentCard && !sessionsCard && !enquiriesCard
      ? h('p', { class: 'muted' }, `Welcome, ${state.me.name}. Use the menu above to get started.`)
      : null,
  );
}

// Internship enquiry pipeline summary, shown on the enquiries page.
export function pipelineSummary(s) {
  const statusTable = h(
    'table',
    null,
    h('thead', null, h('tr', null, h('th', null, 'Status'), h('th', { class: 'num' }, 'Enquiries'))),
    h(
      'tbody',
      null,
      s.byStatus.map((r) =>
        h('tr', null, h('td', null, h('a', { href: `#/enquiries?status=${encodeURIComponent(r.status)}` }, statusBadge(r.status))), h('td', { class: 'num' }, r.count)),
      ),
    ),
  );
  return h(
    'details',
    { class: 'card summary-card' },
    h('summary', null, h('strong', null, 'Pipeline summary'), h('span', { class: 'muted' }, ` · ${s.newCount} new · ${s.dueToday} follow-ups due today · ${s.overdue} overdue`)),
    h(
      'div',
      { class: 'stack' },
      h('div', { class: 'grid-2' }, conversionTable('Conversion by stream', s.byStream, 'Stream'), conversionTable('Conversion by plan', s.byPlan, 'Plan')),
      h('section', { class: 'card card-flush' }, h('h2', null, 'Enquiries by status'), h('div', { class: 'table-wrap' }, statusTable)),
    ),
  );
}
