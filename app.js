/* Shared helpers for index.html and compare.html. */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const DAY_MS = 86400000;
  const GAP_BLANK_HOURS = 12;
  const PV = {};

  PV.DAY_MS = DAY_MS;
  PV.$ = (id) => document.getElementById(id);

  const dayFmt = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
  });
  PV.dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  PV.shortFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  PV.timeFmt = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC'
  });
  PV.dayFmt = dayFmt;

  PV.pretty = (title) => title.replace(/_/g, ' ');
  PV.dateMs = (iso) => Date.parse(iso + 'T00:00:00Z');
  PV.num = (n) => n.toLocaleString('en-US');
  PV.pad = (n) => String(n).padStart(2, '0');
  PV.offsetLabel = (o) => 'day ' + (o > 0 ? '+' + o : String(o));

  function compact(n) {
    if (n >= 1e6) { const v = n / 1e6; return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + 'M'; }
    if (n >= 1e3) { const v = n / 1e3; return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + 'K'; }
    return String(n);
  }
  PV.axisLabel = (n) => (n < 10000 ? PV.num(n) : compact(n));

  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    const head = lines[0].split(',');
    return lines.slice(1).map((line) => {
      const cells = line.split(',');
      const row = {};
      head.forEach((h, i) => { row[h] = cells[i]; });
      return row;
    });
  }
  const optNum = (s) => (s === '' || s === undefined ? null : Number(s));

  PV.load = function () {
    return Promise.all([fetch('hourly.csv'), fetch('daily.csv')])
      .then((responses) => {
        responses.forEach((r) => { if (!r.ok) throw new Error(r.url + ' returned ' + r.status); });
        return Promise.all(responses.map((r) => r.text()));
      })
      .then((texts) => {
        const data = { hourlyBy: new Map(), dailyBy: new Map(), day0: new Map() };
        parseCsv(texts[0]).forEach((r) => {
          const row = {
            date: r.date,
            hour: Number(r.hour_utc),
            t: PV.dateMs(r.date) + Number(r.hour_utc) * 3600000,
            views: optNum(r.views),
            gap: r.suspected_gap === '1'
          };
          if (!data.hourlyBy.has(r.article)) data.hourlyBy.set(r.article, []);
          data.hourlyBy.get(r.article).push(row);
        });
        parseCsv(texts[1]).forEach((r) => {
          const row = { date: r.date, offset: Number(r.day_offset), views: optNum(r.views), gapHours: Number(r.gap_hours) };
          row.blank = row.gapHours >= GAP_BLANK_HOURS || row.views === null;
          if (!data.dailyBy.has(r.article)) data.dailyBy.set(r.article, []);
          data.dailyBy.get(r.article).push(row);
          if (row.offset === 0) data.day0.set(r.article, r.date);
        });
        data.articles = Array.from(data.dailyBy.keys());
        return data;
      });
  };

  PV.fail = function (err) {
    const note = PV.$('note');
    note.replaceChildren();
    note.textContent = 'Could not load hourly.csv and daily.csv. Serve this page over http, not from a local file. ' + err.message;
  };

  PV.el = function (name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    if (attrs) Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(e);
    return e;
  };

  // Linear scale with round ticks, or a log10 scale with a tick per power of ten.
  PV.makeScale = function (maxVal, top, bottom, opts) {
    const o = opts || {};
    if (o.log) {
      const minPos = Math.max(o.minPos || 1, 1e-9);
      let lo = Math.ceil(Math.log10(minPos)) - 1;
      let hi = Math.ceil(Math.log10(Math.max(maxVal, 1)));
      if (hi <= lo) hi = lo + 1;
      const ticks = [];
      for (let p = lo; p <= hi; p++) ticks.push(Math.pow(10, p));
      return {
        y: (v) => bottom - ((Math.log10(Math.max(v, 1e-9)) - lo) / (hi - lo)) * (bottom - top),
        ticks: ticks,
        log: true
      };
    }
    const raw = Math.max(maxVal, 1) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((s) => s * mag).find((s) => s >= raw);
    const max = Math.ceil(Math.max(maxVal, 1) / step) * step;
    const ticks = [];
    for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
    return { y: (v) => bottom - (v / max) * (bottom - top), ticks: ticks, log: false };
  };

  // rows: array of { text, cls, color }
  PV.makeTip = function (host) {
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.setAttribute('aria-hidden', 'true');
    host.appendChild(tip);
    return {
      show(x, top, rows) {
        tip.replaceChildren();
        rows.forEach((r) => {
          const d = document.createElement('div');
          d.className = (r.cls || '') + (r.color ? ' row' : '');
          if (r.color) {
            const sw = document.createElement('span');
            sw.className = 'swatch';
            sw.style.setProperty('--c', r.color);
            d.appendChild(sw);
          }
          d.appendChild(document.createTextNode(r.text));
          tip.appendChild(d);
        });
        tip.style.display = 'block';
        const width = tip.offsetWidth;
        const left = x + 12 + width > host.clientWidth ? x - 12 - width : x + 12;
        tip.style.left = Math.max(0, left) + 'px';
        tip.style.top = top + 'px';
      },
      hide() { tip.style.display = 'none'; }
    };
  };

  PV.yAxis = function (svg, scale, m, W) {
    scale.ticks.forEach((t, i) => {
      const y = scale.y(t);
      PV.el('line', { class: i === 0 ? 'axis' : 'grid', x1: m.l, x2: W - m.r, y1: y, y2: y }, svg);
      const label = PV.el('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end' }, svg);
      label.textContent = PV.axisLabel(t);
    });
  };

  PV.peakLabel = function (svg, cx, y, text, m, W) {
    const anchor = cx > W - m.r - 60 ? 'end' : cx < m.l + 40 ? 'start' : 'middle';
    const t = PV.el('text', { class: 'peak', x: cx, y: Math.max(y - 8, 12), 'text-anchor': anchor }, svg);
    t.textContent = text;
  };

  // headers: string or { name, sub }. body: [{ className, cells }], null cell = no data.
  PV.buildTable = function (host, headers, body, caption, numericFrom) {
    host.replaceChildren();
    const table = document.createElement('table');
    table.className = 'app-stats';
    const cap = document.createElement('caption');
    cap.textContent = caption;
    cap.hidden = true;
    table.appendChild(cap);
    const headRow = table.createTHead().insertRow();
    headers.forEach((h) => {
      const th = document.createElement('th');
      th.scope = 'col';
      if (headRow.cells.length >= numericFrom) th.className = 'app-stats__number';
      if (typeof h === 'string') th.textContent = h;
      else {
        th.appendChild(document.createTextNode(h.name));
        const s = document.createElement('span');
        s.className = 'sub';
        s.textContent = h.sub;
        th.appendChild(s);
      }
      headRow.appendChild(th);
    });
    const tbody = table.createTBody();
    body.forEach((row) => {
      const tr = tbody.insertRow();
      if (row.className) tr.className = row.className;
      row.cells.forEach((c, i) => {
        const td = tr.insertCell();
        if (i >= numericFrom) td.className = 'app-stats__number';
        if (c === null) { td.textContent = 'no data'; td.classList.add('app-stats__muted'); }
        else td.textContent = c;
      });
    });
    host.appendChild(table);
    return table;
  };

  PV.watchResize = function (target, fn) {
    let queued = false;
    new ResizeObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; fn(); });
    }).observe(target);
  };

  window.PV = PV;
})();