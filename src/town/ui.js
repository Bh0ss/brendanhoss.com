// DOM layer for the proximity prompt + content card. Town tells it which
// landmark is nearby (setPrompt) and asks it to open/close the card. Keeps all
// HTML/string-building out of the 3D code.

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

function renderCard(lm) {
  const head = `<div class="card-eyebrow" style="color:#${lm.accent.toString(16).padStart(6, '0')}">${esc(lm.period || '')}</div>
    <h2 class="card-title">${esc(lm.title)}</h2>`;
  const intro = lm.intro ? `<p class="card-intro">${esc(lm.intro)}</p>` : '';

  let body = '';
  if (lm.points) {
    body += '<ul class="card-list">' + lm.points.map((p) => `<li>${esc(p)}</li>`).join('') + '</ul>';
  }
  if (lm.stats) {
    body += '<div class="card-stats">' + lm.stats.map((s) =>
      `<div class="stat"><div class="stat-num" data-num="${s.num}" data-suffix="${s.suffix}">0${s.suffix}</div><div class="stat-label">${esc(s.label)}</div></div>`
    ).join('') + '</div>';
  }
  if (lm.achievements) {
    body += '<div class="card-section">Selected Impact</div><ul class="card-list">' +
      lm.achievements.map((a) => `<li>${esc(a)}</li>`).join('') + '</ul>';
  }
  if (lm.verticals) {
    body += '<div class="card-section">Industries</div><div class="pills">' +
      lm.verticals.map((v) => `<span class="pill">${esc(v)}</span>`).join('') + '</div>';
  }
  if (lm.skills) {
    body += '<div class="card-section">Toolkit</div><div class="pills">' +
      lm.skills.map((s) => `<span class="pill">${esc(s)}</span>`).join('') + '</div>';
  }

  let actions = '';
  if (lm.kind === 'hero' || lm.kind === 'contact') {
    const parts = [`<a class="btn btn-primary" href="/resume.pdf" download="Brendan_Hoss_Resume_2026.pdf">Download résumé</a>`];
    if (lm.linkedin) parts.push(`<a class="btn" href="${esc(lm.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>`);
    if (lm.email) parts.push(`<a class="btn" href="mailto:${esc(lm.email)}">Email</a>`);
    actions = `<div class="card-actions">${parts.join('')}</div>`;
  }
  if (lm.kind === 'intro') {
    actions = `<div class="card-actions"><button class="btn btn-primary" data-close>Start exploring →</button></div>`;
  }

  return `${head}${intro}${body}${actions}`;
}

function animateCounters(root) {
  for (const el of root.querySelectorAll('.stat-num')) {
    const target = parseInt(el.dataset.num, 10);
    const suffix = el.dataset.suffix || '';
    const start = performance.now();
    const step = (now) => {
      const p = Math.min((now - start) / 1100, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

export function createUI() {
  const prompt = document.getElementById('prompt');
  const promptName = document.getElementById('prompt-name');
  const card = document.getElementById('card');
  const cardBody = document.getElementById('card-body');
  const backdrop = document.getElementById('card-backdrop');
  const closeBtn = document.getElementById('card-close');

  let currentPrompt = null;
  let open = false;

  function setPrompt(lm) {
    currentPrompt = lm;
    if (lm && !open) {
      promptName.textContent = lm.sign || lm.title;
      prompt.classList.remove('hidden');
    } else {
      prompt.classList.add('hidden');
    }
  }

  function openCard(lm) {
    if (!lm) return;
    open = true;
    cardBody.innerHTML = renderCard(lm);
    card.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    prompt.classList.add('hidden');
    requestAnimationFrame(() => { card.classList.add('shown'); animateCounters(cardBody); });
  }

  function closeCard() {
    open = false;
    card.classList.remove('shown');
    backdrop.classList.add('hidden');
    setTimeout(() => card.classList.add('hidden'), 260);
    setPrompt(currentPrompt);
  }

  closeBtn.addEventListener('click', closeCard);
  backdrop.addEventListener('click', closeCard);
  cardBody.addEventListener('click', (e) => { if (e.target.matches('[data-close]')) closeCard(); });
  addEventListener('keydown', (e) => { if (e.code === 'Escape' && open) closeCard(); });
  // tapping the prompt opens it (mobile / mouse)
  prompt.addEventListener('click', () => { if (currentPrompt) openCard(currentPrompt); });

  return { setPrompt, openCard, closeCard, isOpen: () => open };
}
