(function () {
  const token = new URLSearchParams(location.search).get('token');
  if (!token) toast('This reset link is not valid. Please request a new one from the login page.', true);
  document.getElementById('reset-form').onsubmit = async (e) => {
    e.preventDefault();
    const p = document.getElementById('n-pass').value;
    if (p !== document.getElementById('n-pass2').value) return toast('The two passwords do not match.', true);
    const btn = e.target.querySelector('button[type=submit]'); btn.classList.add('loading');
    try {
      toast((await api('/auth/reset', { method: 'POST', body: { token, password: p } })).message);
      setTimeout(() => (location.href = '/login.html'), 1600);
    } catch (err) { toast(err.message, true); btn.classList.remove('loading'); }
  };
})();
