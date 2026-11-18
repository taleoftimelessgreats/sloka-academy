// Sign-in and the signed-in associate's account (password change, including the forced first change).
// Rendered with DOM APIs / textContent only. Never use innerHTML with data.

import { api, clearErrors, ensureMeta, field, go, h, mount, showErrors, state, toast } from './core.js';

// ------------------------------------------------------------------ views: login & account

export function viewLogin() {
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true });
  const password = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in');
  const form = h(
    'form',
    { class: 'card login', novalidate: true },
    h('div', { class: 'brand-lg' }, 'Sloka Academy ', h('span', null, 'Admin')),
    field('Email', email, { name: 'email' }),
    field('Password', password, { name: 'password' }),
    h('p', { class: 'form-error', role: 'alert' }),
    submit,
    h('p', { class: 'muted small' }, 'Sloka Academy associates only. Ask an admin if you need an account.'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    submit.disabled = true;
    try {
      const { user } = await api('POST', '/api/auth/login', { email: email.value, password: password.value });
      state.me = user;
      if (!user.mustChangePassword) await ensureMeta(true);
      go('#/');
    } catch (err) {
      showErrors(form, err);
      password.value = '';
      password.focus();
    } finally {
      submit.disabled = false;
    }
  });
  mount('Sign in', h('div', { class: 'login-wrap' }, form));
  email.focus();
}

export function viewAccount() {
  const current = h('input', { type: 'password', name: 'currentPassword', autocomplete: 'current-password', required: true });
  const next = h('input', { type: 'password', name: 'newPassword', autocomplete: 'new-password', required: true, minlength: '10' });
  const confirmPw = h('input', { type: 'password', name: 'confirm', autocomplete: 'new-password', required: true });
  const form = h(
    'form',
    { class: 'card', novalidate: true },
    h('h2', null, 'Change password'),
    h(
      'div',
      { class: 'form-grid' },
      field('Current password', current),
      field('New password', next, { hint: 'At least 10 characters.' }),
      field('Confirm new password', confirmPw),
    ),
    h('p', { class: 'form-error', role: 'alert' }),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Update password')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    if (next.value !== confirmPw.value) {
      form.querySelector('[data-error-for="confirm"]').textContent = 'Passwords do not match.';
      return;
    }
    try {
      await api('POST', '/api/auth/password', { currentPassword: current.value, newPassword: next.value });
      form.reset();
      toast('Password updated. Other sessions have been signed out.');
    } catch (err) {
      showErrors(form, err);
    }
  });
  mount(
    'Account',
    h('div', { class: 'page-head' }, h('h1', null, 'Account')),
    h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'card' },
        h(
          'dl',
          { class: 'info' },
          h('dt', null, 'Name'),
          h('dd', null, state.me.name),
          h('dt', null, 'Email'),
          h('dd', null, state.me.email),
          h('dt', null, 'Role'),
          h('dd', null, state.me.roleName || state.me.role),
          h('dt', null, 'Sees'),
          h('dd', null, { own: 'Their own registrations', team: "Their own and their team's registrations", all: 'All registrations' }[state.me.scope] || ''),
        ),
      ),
      form,
    ),
  );
}

/** First sign-in with a temporary password (a new associate, or a reset): choose a password before anything else. */
export function viewFirstPassword() {
  const current = h('input', { type: 'password', name: 'currentPassword', autocomplete: 'current-password', required: true });
  const next = h('input', { type: 'password', name: 'newPassword', autocomplete: 'new-password', required: true, minlength: '10' });
  const confirmPw = h('input', { type: 'password', name: 'confirm', autocomplete: 'new-password', required: true });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Set my password');
  const form = h(
    'form',
    { class: 'card login', novalidate: true },
    h('div', { class: 'brand-lg' }, 'Sloka Academy ', h('span', null, 'Admin')),
    h('h2', null, `Welcome, ${state.me.name}`),
    h('p', { class: 'muted' }, 'You signed in with a temporary password. Choose your own to continue.'),
    field('Temporary password', current, { name: 'currentPassword' }),
    field('New password', next, { name: 'newPassword', hint: 'At least 10 characters.' }),
    field('Confirm new password', confirmPw, { name: 'confirm' }),
    h('p', { class: 'form-error', role: 'alert' }),
    submit,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    if (next.value !== confirmPw.value) {
      form.querySelector('[data-error-for="confirm"]').textContent = 'Passwords do not match.';
      return;
    }
    submit.disabled = true;
    try {
      await api('POST', '/api/auth/password', { currentPassword: current.value, newPassword: next.value });
      state.me = (await api('GET', '/api/auth/me')).user;
      await ensureMeta(true);
      toast('Password set. Welcome to the portal.');
      go('#/');
    } catch (err) {
      showErrors(form, err);
    } finally {
      submit.disabled = false;
    }
  });
  mount('Choose a password', h('div', { class: 'login-wrap' }, form));
  current.focus();
}
