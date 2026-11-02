(async function () {
  if (!requireLogin()) return;
  const $ = (id) => document.getElementById(id);
  let user;

  try {
    ({ user } = await api('/auth/me'));
    $('p-name').value = user.name; $('p-email').value = user.email;
    $('p-phone').value = user.phone || ''; $('p-notify').checked = user.notify_email;
    store.set(store.token, user);
    $('verify-status').innerHTML = user.email_verified === false
      ? '✕ Not confirmed yet — <button type="button" class="link-btn" id="resend-verify">Resend confirmation email</button>'
      : '✓ Email confirmed';
    const rv = $('resend-verify');
    if (rv) rv.onclick = async () => {
      rv.disabled = true;
      try { toast((await api('/auth/resend-verification', { method: 'POST' })).message); } catch (err) { toast(err.message, true); rv.disabled = false; }
    };
  } catch (e) { return requireLogin(); }

  async function save(extra, msg) {
    const body = { name: $('p-name').value, phone: $('p-phone').value, notify_email: $('p-notify').checked, ...extra };
    const r = await api('/auth/me', { method: 'PUT', body });
    store.set(r.token, r.user); user = r.user; renderHeader(); toast(msg);
  }

  $('profile-form').onsubmit = async (e) => { e.preventDefault(); try { await save({}, 'Profile saved.'); } catch (err) { toast(err.message, true); } };
  $('notify-form').onsubmit = async (e) => { e.preventDefault(); try { await save({}, 'Preference saved.'); } catch (err) { toast(err.message, true); } };
  $('security-form').onsubmit = async (e) => {
    e.preventDefault();
    try { await save({ new_password: $('p-pass').value }, 'Password updated.'); $('p-pass').value = ''; } catch (err) { toast(err.message, true); }
  };
})();
