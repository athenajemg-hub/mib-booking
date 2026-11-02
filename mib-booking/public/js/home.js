/* Home: packages, add-ons and the photo slideshow */
(function slideshow(root, interval) {
  if (!root) return;
  const slides = [...root.querySelectorAll('.slide')];
  const dotsEl = root.querySelector('.ss-dots'), bar = root.querySelector('.ss-bar');
  let i = 0, startX = null;
  root.style.setProperty('--dur', interval + 'ms');
  dotsEl.innerHTML = slides.map((_, n) => `<button class="ss-dot" aria-label="Show photo ${n + 1}"></button>`).join('');
  const dots = [...dotsEl.children];

  function show(n) {
    i = (n + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('active', k === i));
    dots.forEach((d, k) => d.classList.toggle('active', k === i));
    bar.classList.remove('run'); void bar.offsetWidth; bar.classList.add('run'); // restart progress bar
  }
  bar.addEventListener('animationend', () => show(i + 1)); // progress bar drives autoplay (pauses on hover)
  dots.forEach((d, k) => (d.onclick = () => show(k)));
  root.querySelector('.ss-prev').onclick = () => show(i - 1);
  root.querySelector('.ss-next').onclick = () => show(i + 1);
  root.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') show(i - 1); if (e.key === 'ArrowRight') show(i + 1); });
  root.addEventListener('touchstart', (e) => (startX = e.touches[0].clientX), { passive: true });
  root.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1));
    startX = null;
  });
  show(0);
})(document.getElementById('slideshow'), 5500);

(async function () {
  try {
    const [packages, addons] = await Promise.all([api('/packages'), api('/addons')]);
    document.getElementById('package-list').innerHTML = packages.map((p) => `
      <article class="card pkg reveal">
        <div class="pkg-top"><h3>${esc(p.name)}</h3><div class="price">${peso(p.price)}</div></div>
        <div class="chips"><span class="chip">Good for ${esc(p.pax_range)} pax</span><span class="chip">${p.hours} hours</span></div>
        <ul class="checks">${p.inclusions.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
        <a class="btn" href="/book.html?package=${p.id}">Book this package →</a>
      </article>`).join('');
    document.getElementById('addon-list').innerHTML = addons.map((a) => `
      <div class="addon-row reveal"><span>${esc(a.name)}${a.note ? `<br><small class="muted">${esc(a.note)}</small>` : ''}</span>
      <strong>${peso(a.price)}${a.unit === 'hr' ? '/hr' : ''}</strong></div>`).join('');
    observeReveal();
  } catch (e) {
    document.getElementById('package-list').innerHTML = '<p>Could not load packages. Is the server running?</p>';
  }
})();
