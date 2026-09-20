(() => {
  'use strict';

  /* ================= Config ================= */
  const CONFIG = {
    API_URL: '/api/analyze',      // POST { message } -> { score, level, summary, findings:[{title,detail}], advice:[] }
    HEALTH_URL: '/api/health',    // GET, any 2xx = online
    TIMEOUT_MS: 8000,
    MAX: 5000,
    MIN: 10
  };

  const $ = id => document.getElementById(id);
  const el = {
    engine: $('engine'), theme: $('theme'), msg: $('message'), counter: $('counter'),
    scan: $('scan'), demo: $('demo'), clear: $('clear'), error: $('error'),
    scanner: document.querySelector('.scanner'), result: $('result'),
    score: $('score'), level: $('level'), meter: $('meter'), fill: $('fill'),
    summary: $('summary'), findings: $('findings'), advice: $('advice'),
    globeState: $('globeState'), globeCaption: $('globeCaption')
  };
  const globe = window.ScamGlobe || { setThreat() {}, setScanning() {} };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const IDLE_TEXT = 'Drag the globe · paste a message to scan';

  /* ================= Dark mode ================= */
  const root = document.documentElement;
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    el.theme.setAttribute('aria-pressed', String(t === 'dark'));
    el.theme.querySelector('.ico').textContent = t === 'dark' ? '☀' : '☾';
    el.theme.querySelector('.lbl').textContent = t === 'dark' ? 'Light mode' : 'Dark mode';
  }
  applyTheme(root.getAttribute('data-theme') || 'light');
  el.theme.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('scamshield-theme', next); } catch (e) { /* storage unavailable */ }
  });

  /* ================= Button glow follows the cursor ================= */
  document.addEventListener('pointermove', e => {
    const b = e.target.closest && e.target.closest('.btn');
    if (!b) return;
    const r = b.getBoundingClientRect();
    b.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    b.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  /* ================= Engine status ================= */
  function fetchTimeout(url, opts, ms) {
    const ctl = new AbortController();
    const id = setTimeout(() => ctl.abort(), ms);
    return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(id));
  }
  function setEngine(state, text) {
    el.engine.dataset.state = state;
    el.engine.textContent = text;
  }
  async function checkEngine() {
    try {
      const r = await fetchTimeout(CONFIG.HEALTH_URL, { method: 'GET' }, 3000);
      if (!r.ok) throw new Error('offline');
      setEngine('online', 'API connected');
    } catch (e) {
      setEngine('local', 'Local check mode');
    }
  }

  /* ================= Counter / input ================= */
  function updateCounter() {
    const n = el.msg.value.length;
    el.counter.textContent = `${n} / ${CONFIG.MAX}`;
    el.counter.classList.toggle('warn', n > CONFIG.MAX * 0.9);
  }
  el.msg.addEventListener('input', () => { updateCounter(); hideError(); });
  el.msg.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); scan(); }
  });

  function showError(text) {
    el.error.textContent = text;
    el.error.classList.remove('hidden');
    el.msg.classList.remove('shake');
    void el.msg.offsetWidth;
    el.msg.classList.add('shake');
  }
  function hideError() { el.error.classList.add('hidden'); }

  /* ================= Local analyser (fallback) ================= */
  const RULES = [
    { w: 14, title: 'Pressure and urgency',
      detail: 'Scammers rush you so you act before you can verify anything.',
      re: /\b(urgent(ly)?|immediately|act now|right away|last chance|final (notice|warning)|expires? (today|soon|tonight)|within \d+\s*(hours?|hrs?|minutes?|mins?)|account (will be )?(suspended|blocked|closed|deactivated)|suspended|deactivated)\b/i },
    { w: 22, title: 'Asks for money or a fee',
      detail: 'Requests for fees, gift cards, crypto or transfers are a classic scam pattern.',
      re: /\b(gift ?cards?|wire transfer|western union|bitcoin|crypto(currency)?|usdt|processing fee|registration fee|advance fee|clearance fee|customs fee|send (me )?money|pay (a )?(small )?fee|refundable deposit|security deposit)\b/i },
    { w: 26, title: 'Requests sensitive information',
      detail: 'Real banks and services never ask for OTPs, PINs, passwords or full card details by message.',
      re: /\b(otp|one[- ]time (password|passcode)|password|passcode|pin(?!\s*code)|cvv|card number|aadhaar|pan (card|number)|ssn|social security|verify your (account|identity|details)|update (your )?kyc|kyc (update|verification|expired|pending))\b/i },
    { w: 18, title: 'Too-good-to-be-true reward',
      detail: 'Unexpected prizes, lotteries and refunds are used as bait.',
      re: /\b(you (have )?won|winner|lottery|jackpot|congratulations|claim your (prize|reward|gift)|cash ?back reward|free (iphone|gift|vouchers?)|unclaimed (refund|funds))\b/i },
    { w: 16, title: 'Suspicious job or earning offer',
      detail: 'Easy money, no experience needed and hiring over chat apps are common fake-job signs.',
      re: /\b(work from home|earn (up to )?(rs\.?|₹|\$|inr)?\s?\d[\d,]*\s*(per|a|\/)\s*(day|week|hour)|daily (income|payout|salary)|no experience (needed|required)|part[- ]?time job|task[- ]based|contact (us )?on (telegram|whatsapp)|(telegram|whatsapp) (group|channel|hr))\b/i },
    { w: 16, title: 'Threats or legal pressure',
      detail: 'Fear of arrest, fines or legal action is used to force a quick payment.',
      re: /\b(arrest(ed)?|legal action|police (case|complaint)|case (has been )?(filed|registered)|warrant|penalty|court notice|digital arrest|customs officer)\b/i },
    { w: 10, title: 'Asks you to keep it secret',
      detail: 'Scammers isolate victims so friends and family cannot warn them.',
      re: /\b(don'?t tell|do not (tell|share this)|keep (this )?(a )?(secret|confidential)|tell no one)\b/i },
    { w: 8, title: 'Pretends to be a trusted organisation',
      detail: 'Banks, couriers, tax offices and delivery firms are commonly impersonated.',
      re: /\b(dear (customer|user|account holder)|your bank|bank (account|team)|income tax|courier|parcel|package (is )?(held|pending|on hold)|delivery (failed|attempt)|customer (care|support) (team|executive)|amazon|paypal|netflix)\b/i }
  ];

  const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')]+|\b(?:bit\.ly|tinyurl\.com|t\.co|cutt\.ly|rb\.gy|is\.gd|goo\.gl|shorturl\.at|wa\.me)\/[^\s<>"')]+/gi;
  const SHORTENERS = /^(bit\.ly|tinyurl\.com|t\.co|cutt\.ly|rb\.gy|is\.gd|goo\.gl|shorturl\.at)$/;
  const BAD_TLD = /\.(xyz|top|click|icu|work|buzz|cyou|rest|monster|sbs|cfd|vip|link|loan)$/;
  const LINK_REASON = {
    short: 'uses a link shortener that hides the real destination',
    ip: 'points to a raw IP address',
    http: 'is not encrypted (http)',
    tld: 'uses a domain ending often abused by scammers',
    at: "contains an '@' that can disguise the real address",
    long: 'has an unusually long or hyphen-heavy domain'
  };
  const LINK_WEIGHT = { short: 14, ip: 20, http: 8, tld: 14, at: 14, long: 8 };

  function linkFinding(text) {
    const links = text.match(URL_RE);
    if (!links) return null;
    const flags = new Set();
    for (const raw of links) {
      const l = raw.replace(/[.,;:!?]+$/, '');
      const host = l.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[\/?#]/)[0].toLowerCase().split(':')[0];
      if (SHORTENERS.test(host)) flags.add('short');
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) flags.add('ip');
      if (/^http:\/\//i.test(l)) flags.add('http');
      if (BAD_TLD.test(host)) flags.add('tld');
      if (l.includes('@')) flags.add('at');
      if ((host.match(/-/g) || []).length >= 2 || host.split('.').length > 4) flags.add('long');
    }
    const first = links[0].length > 60 ? links[0].slice(0, 57) + '…' : links[0];
    if (!flags.size) {
      return { w: 6, title: 'Contains a link',
        detail: `Don't tap links in unexpected messages; open the official app or site yourself. First link: ${first}` };
    }
    let w = 0; const reasons = [];
    flags.forEach(f => { w += LINK_WEIGHT[f]; reasons.push(LINK_REASON[f]); });
    return { w: w + 6, title: 'Suspicious link', detail: `Link issues: ${reasons.join('; ')}. First link: ${first}` };
  }

  const ADVICE = {
    high: [
      'Do not click any links or reply to this message.',
      'Never share OTPs, PINs or passwords. No real organisation asks for them by message.',
      'Contact the organisation using the number on its official website or app.',
      'Block the sender and report the message to your bank or your national cybercrime service.'
    ],
    medium: [
      "Don't click links. Open the official app or website yourself instead.",
      'Verify the sender through an official channel before replying.',
      'Ask someone you trust before sending money or personal details.'
    ],
    low: [
      'Stay cautious with unexpected links or requests.',
      'If something feels off, check with the sender using a number you already trust.',
      'Never share OTPs or passwords with anyone.'
    ]
  };
  const SUMMARY = {
    high: 'Several strong scam signals were found. Treat this message as dangerous.',
    medium: 'Some warning signs were found. Verify through an official channel before acting.',
    low: 'No strong scam signals were found, but scams evolve, so stay cautious.'
  };
  const LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };
  const levelFor = s => (s >= 60 ? 'high' : s >= 30 ? 'medium' : 'low');

  function localAnalyze(text) {
    const hits = [];
    for (const r of RULES) if (r.re.test(text)) hits.push(r);
    const link = linkFinding(text);
    if (link) hits.push(link);

    let score = hits.reduce((s, h) => s + h.w, 0);
    if (hits.length >= 3) score += 8;
    score = clamp(Math.round(score), 0, 100);
    const level = levelFor(score);

    hits.sort((a, b) => b.w - a.w);
    return {
      score, level,
      summary: SUMMARY[level] + ' (Checked locally in your browser.)',
      findings: hits.slice(0, 6).map(h => ({ title: h.title, detail: h.detail })),
      advice: ADVICE[level]
    };
  }

  /* ================= API ================= */
  function normalize(d) {
    if (!d || typeof d !== 'object') throw new Error('bad response');
    const n = Number(d.score);
    if (!Number.isFinite(n)) throw new Error('bad score');
    const score = clamp(Math.round(n), 0, 100);
    const lv = String(d.level || '').toLowerCase();
    const level = LABEL[lv] ? lv : levelFor(score);
    const findings = (Array.isArray(d.findings) ? d.findings : []).slice(0, 8).map(f =>
      typeof f === 'string'
        ? { title: f, detail: '' }
        : { title: String(f.title || f.name || 'Finding'), detail: String(f.detail || f.description || '') });
    const advice = (Array.isArray(d.advice) ? d.advice : ADVICE[level]).slice(0, 8).map(String);
    return { score, level, summary: String(d.summary || SUMMARY[level]), findings, advice };
  }

  async function analyze(text) {
    try {
      const r = await fetchTimeout(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      }, CONFIG.TIMEOUT_MS);
      if (!r.ok) throw new Error('status ' + r.status);
      const res = normalize(await r.json());
      setEngine('online', 'API connected');
      return res;
    } catch (e) {
      setEngine('local', 'Local check mode');
      return localAnalyze(text);
    }
  }

  /* ================= Render ================= */
  function findingNode(f, i, level) {
    const row = document.createElement('div');
    row.className = 'finding';
    row.style.setProperty('--i', i);
    const icon = document.createElement('b');
    icon.textContent = f.ok ? '✓' : '!';
    icon.setAttribute('aria-hidden', 'true');
    const box = document.createElement('div');
    const h = document.createElement('h3'); h.textContent = f.title;
    box.appendChild(h);
    if (f.detail) { const p = document.createElement('p'); p.textContent = f.detail; box.appendChild(p); }
    row.append(icon, box);
    return row;
  }

  function countUp(to) {
    if (reduce) { el.score.textContent = to; return; }
    const t0 = performance.now(), dur = 900;
    (function tick(now) {
      const p = Math.min(1, (now - t0) / dur);
      el.score.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  function render(res) {
    el.result.classList.remove('hidden', 'show');
    void el.result.offsetWidth;                       // restart entrance animation
    el.result.classList.add('show');
    el.result.dataset.level = res.level;

    el.level.textContent = LABEL[res.level];
    el.summary.textContent = res.summary;

    const items = res.findings.length
      ? res.findings
      : [{ title: 'No obvious scam signals', detail: 'Nothing in this message matched common scam patterns.', ok: true }];
    el.findings.replaceChildren(...items.map((f, i) => findingNode(f, i, res.level)));
    el.advice.replaceChildren(...res.advice.map(a => {
      const li = document.createElement('li'); li.textContent = a; return li;
    }));

    el.fill.style.width = '0%';
    void el.fill.offsetWidth;
    el.fill.style.width = res.score + '%';
    el.meter.setAttribute('aria-valuenow', String(res.score));
    countUp(res.score);

    globe.setThreat(res.score / 100);
    el.globeState.textContent = `${LABEL[res.level]} · score ${res.score}`;
    el.globeCaption.dataset.level = res.level;

    el.result.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    el.result.focus({ preventScroll: true });
  }

  /* ================= Scan flow ================= */
  let busy = false, typing = false;

  function setBusy(on) {
    busy = on;
    el.scan.disabled = on;
    el.scan.classList.toggle('loading', on);
    el.scan.textContent = on ? 'Scanning…' : 'Scan message →';
    el.scanner.classList.toggle('busy', on);
    el.result.setAttribute('aria-busy', String(on));
  }

  async function scan() {
    if (busy || typing) return;
    const text = el.msg.value.trim();
    hideError();
    if (text.length < CONFIG.MIN) {
      showError(`Paste a longer message (at least ${CONFIG.MIN} characters) to get a useful result.`);
      el.msg.focus();
      return;
    }
    setBusy(true);
    globe.setScanning(true);
    el.globeState.textContent = 'Scanning message…';
    delete el.globeCaption.dataset.level;

    const started = performance.now();
    const res = await analyze(text);
    await sleep(Math.max(0, 1000 - (performance.now() - started)));   // let the scan animation play

    globe.setScanning(false);
    setBusy(false);
    render(res);
  }

  /* ================= Demo + clear ================= */
  const DEMOS = [
    'URGENT: Your bank account will be blocked within 24 hours. Complete KYC update now and share the OTP you receive at http://bank-kyc-verify.top/login to avoid a penalty. Do not tell anyone.',
    'Congratulations! You are selected for a work from home job. Earn ₹5000 per day, no experience required. Pay a small registration fee of ₹499 and contact us on Telegram: https://bit.ly/easy-job-now',
    'Hi Priya, your dental appointment is confirmed for Tuesday at 4 PM. Reply YES to confirm or call the clinic to reschedule. See you soon!'
  ];
  let demoIdx = 0;

  async function runDemo() {
    if (busy || typing) return;
    typing = true;
    hideError();
    const text = DEMOS[demoIdx++ % DEMOS.length];
    if (reduce) {
      el.msg.value = text;
    } else {
      el.msg.value = '';
      for (let i = 0; i < text.length; i += 3) {
        el.msg.value = text.slice(0, i + 3);
        updateCounter();
        await sleep(14);
      }
    }
    el.msg.value = text;
    updateCounter();
    typing = false;
    scan();
  }

  function clearAll() {
    if (busy || typing) return;
    el.msg.value = '';
    updateCounter();
    hideError();
    el.result.classList.add('hidden');
    globe.setThreat(0.35);
    el.globeState.textContent = IDLE_TEXT;
    delete el.globeCaption.dataset.level;
    el.msg.focus();
  }

  el.scan.addEventListener('click', scan);
  el.demo.addEventListener('click', runDemo);
  el.clear.addEventListener('click', clearAll);

  updateCounter();
  checkEngine();
})();