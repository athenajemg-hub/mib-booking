(function () {
  const qs = new URLSearchParams(location.search);
  const next = qs.get('next');
  if (qs.get('verified')) toast('Email confirmed! You can now log in and book.');
  if (qs.get('verify') === 'invalid') toast('That confirmation link is invalid or was already used.', true);
  const forms = { login: document.getElementById('login-form'), register: document.getElementById('register-form'), forgot: document.getElementById('forgot-form') };
  const showForm = (name) => Object.entries(forms).forEach(([k, f]) => (f.hidden = k !== name));

  document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    Object.entries(forms).forEach(([k, f]) => (f.hidden = k !== t.dataset.tab));
  }));

  function done({ token, user }) {
    store.set(token, user);
    location.href = next && next.startsWith('/') ? next : user.role === 'customer' ? '/book.html' : '/admin.html';
  }

  forms.login.onsubmit = async (e) => {
    e.preventDefault();
    try {
      done(await api('/auth/login', { method: 'POST', body: { email: document.getElementById('l-email').value, password: document.getElementById('l-pass').value } }));
    } catch (err) { toast(err.message, true); }
  };

  // Prevent spaces in the registration password as the user types or pastes.
  const registerPassword = document.getElementById('r-pass');
  registerPassword.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.code === 'Space') e.preventDefault();
  });
  registerPassword.addEventListener('input', () => {
    const start = registerPassword.selectionStart;
    const before = registerPassword.value;
    const after = before.replace(/\\s/g, '');
    if (before !== after) {
      registerPassword.value = after;
      const pos = Math.max(0, start - (before.slice(0, start).length - before.slice(0, start).replace(/\\s/g, '').length));
      registerPassword.setSelectionRange(pos, pos);
    }
  });

  forms.register.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/auth/register', { method: 'POST', body: {
        name: document.getElementById('r-name').value, email: document.getElementById('r-email').value,
        phone: document.getElementById('r-phone').value, password: document.getElementById('r-pass').value } });
      if (r.verify_sent) { toast('Account created! We emailed you a link to confirm your address.'); setTimeout(() => done(r), 1800); }
      else done(r);
    } catch (err) { toast(err.message, true); }
  };

  document.getElementById('forgot-link').onclick = (e) => {
    e.preventDefault(); showForm('forgot');
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.getElementById('f-email').value = document.getElementById('l-email').value;
  };
  document.getElementById('back-login').onclick = (e) => { e.preventDefault(); document.querySelector('.tab[data-tab="login"]').click(); };
  forms.forgot.onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]'); btn.classList.add('loading');
    try { toast((await api('/auth/forgot', { method: 'POST', body: { email: document.getElementById('f-email').value } })).message); }
    catch (err) { toast(err.message, true); }
    btn.classList.remove('loading');
  };
})();
