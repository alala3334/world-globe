'use strict';
/* せかい地球儀 — globe.gl で描く地理学習用の地球儀 */

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CONT_COLOR = {
  'アジア': '#f4a259', 'ヨーロッパ': '#5b8def', 'アフリカ': '#e4c35a', '北アメリカ': '#e76f8a',
  '南アメリカ': '#5fd08a', 'オセアニア': '#43c6db', '南極': '#d9e2ef'
};
const MODES = {
  pop:   { label: '人口',        f: c => c.pop,  fmt: v => fmtPop(v), log: true, from: [255, 240, 200], to: [200, 30, 60] },
  area:  { label: '面積',        f: c => c.area, fmt: v => fmtArea(v), log: true, from: [220, 245, 230], to: [20, 110, 80] },
  dens:  { label: '人口密度',    f: c => dens(c), fmt: v => fmtNum(v, 0) + '人/km²', log: true, from: [235, 235, 255], to: [90, 30, 160] },
  gdppc: { label: '1人あたりGDP', f: c => gdppc(c), fmt: v => '$' + fmtNum(v, 0), log: true, from: [255, 245, 210], to: [180, 120, 0] },
};

let C = [], byId = {}, feats = [], globe;
let mode = 'photo', selected = null, hoverD = null;
let quiz = null; // クイズ状態

/* ---------- 数値の書式 ---------- */
function fmtNum(v, d = 0) { return v == null ? '—' : Number(v).toLocaleString('ja-JP', { maximumFractionDigits: d }); }
function fmtPop(v) {
  if (v == null) return '—';
  if (v >= 1e8) return (v / 1e8).toFixed(2).replace(/\.?0+$/, '') + '億人';
  if (v >= 1e4) return fmtNum(Math.round(v / 1e4)) + '万人';
  return fmtNum(v) + '人';
}
function fmtArea(v) { return v == null ? '—' : fmtNum(v) + ' km²'; }
function fmtUSD(v) {
  if (v == null) return '—';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + '兆';
  if (v >= 1e8) return '$' + fmtNum(Math.round(v / 1e8)) + '億';
  return '$' + fmtNum(v);
}
const dens = c => (c.pop && c.area) ? c.pop / c.area : null;
const gdppc = c => (c.gdp && c.pop) ? c.gdp / c.pop : null;
const flagUrl = (c, w = 160) => `https://flagcdn.com/w${w}/${c.a2.toLowerCase()}.png`;
const isCountry = c => c.un || ['TWN', 'PSE', 'VAT', 'UNK', 'ESH'].includes(c.id);

/* ---------- 起動 ---------- */
init();
async function init() {
  const [countries, geo] = await Promise.all([
    fetch('data/countries.json').then(r => r.json()),
    fetch('data/borders.geojson').then(r => r.json()),
  ]);
  C = countries;
  C.forEach(c => byId[c.id] = c);
  feats = geo.features.filter(f => byId[f.properties.id]);
  feats.forEach(f => f.c = byId[f.properties.id]);
  const withPoly = new Set(feats.map(f => f.c.id));
  C.forEach(c => c.hasPoly = withPoly.has(c.id));

  globe = Globe({ animateIn: true })($('#globe'))
    .globeImageUrl('img/earth-blue-marble.jpg')
    .bumpImageUrl('img/earth-topology.png')
    .backgroundImageUrl('img/night-sky.png')
    .showAtmosphere(true).atmosphereColor('#6fb8ff').atmosphereAltitude(0.18)
    .polygonsData(feats)
    .polygonCapColor(capColor)
    .polygonSideColor(() => 'rgba(0,0,0,0.25)')
    .polygonStrokeColor(d => d === selectedFeat() ? '#ffcc33' : 'rgba(255,255,255,0.55)')
    .polygonAltitude(d => d === selectedFeat() ? 0.03 : d === hoverD ? 0.014 : 0.006)
    .polygonsTransitionDuration(250)
    .onPolygonHover(d => { hoverD = d; globe.polygonAltitude(globe.polygonAltitude()); document.body.style.cursor = d ? 'pointer' : ''; })
    .onPolygonClick(d => onPick(d.c))
    // 小さい国（境界データが無い国）は点で表示
    .pointsData(C.filter(c => !c.hasPoly && isCountry(c) && c.ll))
    .pointLat(c => c.ll[0]).pointLng(c => c.ll[1])
    .pointColor(c => c === selected ? '#ffcc33' : '#ff7b54').pointAltitude(0.01).pointRadius(0.35)
    .onPointClick(c => onPick(c))
    .htmlElementsData([])
    .htmlLat(d => d.lat).htmlLng(d => d.lng).htmlAltitude(0.012)
    .htmlElement(d => d.el)
    .onGlobeClick(() => { if (!quiz) closeSheet(); });

  globe.pointOfView({ lat: 30, lng: 135, altitude: 2.3 });
  const ctr = globe.controls();
  ctr.autoRotateSpeed = 0.35;
  ctr.enableDamping = true;

  window.addEventListener('resize', fit); fit();
  bindUI();
  updateLabels();
  setTimeout(() => $('#loading').classList.add('done'), 600);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
function fit() { globe.width(innerWidth).height(innerHeight); }
function selectedFeat() { return selected ? feats.find(f => f.c === selected) : null; }

/* ---------- 色 ---------- */
let scale = null;
function buildScale() {
  const m = MODES[mode]; if (!m) { scale = null; return; }
  const vals = C.filter(isCountry).map(m.f).filter(v => v > 0);
  const tr = m.log ? Math.log10 : x => x;
  let lo = Math.min(...vals.map(tr)), hi = Math.max(...vals.map(tr));
  // 外れ値に引っ張られないよう 2%〜98% で切る
  const s = vals.map(tr).sort((a, b) => a - b);
  lo = s[Math.floor(s.length * 0.02)]; hi = s[Math.floor(s.length * 0.98)];
  scale = v => {
    if (!(v > 0)) return null;
    const t = Math.max(0, Math.min(1, (tr(v) - lo) / (hi - lo)));
    return t;
  };
  scale.lo = m.log ? 10 ** lo : lo; scale.hi = m.log ? 10 ** hi : hi;
}
function mix(a, b, t) { return a.map((x, i) => Math.round(x + (b[i] - x) * t)); }
function capColor(d) {
  const c = d.c;
  if (quiz && quiz.flash && quiz.flash[c.id]) return quiz.flash[c.id];
  if (c === selected) return 'rgba(255,204,51,0.55)';
  if (mode === 'photo') return d === hoverD ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0)';
  if (mode === 'cont') return hexA(CONT_COLOR[c.cont] || '#888', d === hoverD ? 1 : 0.85);
  const m = MODES[mode], t = scale(m.f(c));
  if (t == null) return 'rgba(120,120,120,0.6)';
  const [r, g, b] = mix(m.from, m.to, t);
  return `rgba(${r},${g},${b},${d === hoverD ? 1 : 0.9})`;
}
function hexA(h, a) { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
function refreshColors() { globe.polygonCapColor(capColor).polygonStrokeColor(globe.polygonStrokeColor()).polygonAltitude(globe.polygonAltitude()).pointColor(globe.pointColor()); }

function setMode(m) {
  mode = m;
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  buildScale();
  globe.globeImageUrl(m === 'photo' ? 'img/earth-blue-marble.jpg' : null)
    .globeMaterial().color?.set(m === 'photo' ? '#ffffff' : '#0b2547');
  refreshColors();
  drawLegend();
}
function drawLegend() {
  const L = $('#legend');
  if (mode === 'photo') { L.hidden = true; return; }
  L.hidden = false;
  if (mode === 'cont') {
    L.innerHTML = Object.entries(CONT_COLOR).filter(([k]) => k !== '南極')
      .map(([k, v]) => `<span class="sw"><i style="background:${v}"></i>${k}</span>`).join('');
    return;
  }
  const m = MODES[mode];
  L.innerHTML = `<b>${m.label}</b><div class="bar" style="background:linear-gradient(90deg,rgb(${m.from}),rgb(${m.to}))"></div>
    <div class="ends"><span>${m.fmt(scale.lo)}</span><span>${m.fmt(scale.hi)}</span></div>`;
}

/* ---------- ラベル ---------- */
function updateLabels() {
  const items = [];
  const quizHide = quiz && (quiz.type === 'where' || quiz.type === 'which');
  if ($('#tgNames').checked && !quizHide) {
    C.filter(c => isCountry(c) && c.ll && (c.hasPoly || c.area > 0)).forEach(c => {
      // 小さい国は名前を出しすぎると見づらいので面積で絞る
      if (c.area < 25000 && c !== selected) return;
      const ll = labelPos(c);
      items.push({ lat: ll[0], lng: ll[1], el: el('div', 'lbl' + (c.area > 2e6 ? ' big' : ''), esc(c.ja)) });
    });
  }
  if ($('#tgCaps').checked && !(quiz && quiz.type === 'capital')) {
    C.filter(c => isCountry(c) && c.capLL && c.cap.length).forEach(c => {
      items.push({ lat: c.capLL[0], lng: c.capLL[1], el: el('div', 'lbl cap', esc(c.cap[0])) });
    });
  }
  globe.htmlElementsData(items);
}
// 国名を置く位置：一番大きいポリゴンの重心付近
const LABEL_FIX = { USA: [39, -98], RUS: [61, 96], CAN: [58, -105], FRA: [46.5, 2.5], NOR: [62, 9], CHL: [-33, -71], IDN: [-1.5, 114], NZL: [-42, 172] };
function labelPos(c) { return LABEL_FIX[c.id] || c.ll; }

/* ---------- 国を選ぶ ---------- */
function onPick(c) {
  if (quiz && quiz.type === 'where') return quizAnswerWhere(c);
  select(c, true);
}
function select(c, fly) {
  selected = c;
  refreshColors();
  updateLabels();
  if (fly) flyTo(c);
  renderSheet(c);
}
function flyTo(c, alt) {
  const ll = labelPos(c);
  const narrow = innerWidth < 820;
  const a = (alt || (c.area > 5e6 ? 1.6 : c.area > 5e5 ? 1.1 : c.area > 5e4 ? 0.8 : 0.55)) * (narrow ? 1.5 : 1);
  // スマホではシートが下半分を覆うので、少し南を中心にして国が上側に見えるようにする
  const shift = narrow ? a * 8 : 0;
  globe.pointOfView({ lat: ll[0] - shift, lng: ll[1], altitude: a }, 1200);
  stopSpin();
}
function closeSheet() {
  $('#sheet').hidden = true;
  if (selected) { selected = null; refreshColors(); updateLabels(); }
}

function renderSheet(c) {
  const jp = byId.JPN;
  const d = dens(c), pc = gdppc(c);
  const ratio = c.area && jp.area ? c.area / jp.area : null;
  const ratioTxt = ratio == null || c.id === 'JPN' ? '' : ratio >= 1 ? `日本の約${fmtNum(ratio, ratio < 10 ? 1 : 0)}倍` : `日本の約${fmtNum(1 / ratio, 1)}分の1`;
  const popRatio = c.pop && jp.pop && c.id !== 'JPN' ? (c.pop >= jp.pop ? `日本の約${fmtNum(c.pop / jp.pop, 1)}倍` : `日本の約${fmtNum(c.pop / jp.pop * 100, 1)}%`) : '';
  const rankOf = (f) => { const arr = C.filter(isCountry).filter(x => f(x) > 0).sort((a, b) => f(b) - f(a)); const i = arr.indexOf(c); return i >= 0 ? `世界${i + 1}位` : ''; };
  const tags = [c.cont, c.sub].filter((v, i, a) => v && a.indexOf(v) === i).map(t => `<span class="tag">${esc(t)}</span>`);
  if (c.landlocked) tags.push('<span class="tag">内陸国（海に面していない）</span>');
  if (!c.un) tags.push(`<span class="tag">${c.indep ? '国連非加盟' : '地域・属領'}</span>`);
  if (!c.borders.length && c.hasPoly !== undefined) tags.push('<span class="tag">陸の国境なし</span>');

  const nb = c.borders.map(id => byId[id]).filter(Boolean)
    .map(n => `<button data-go="${n.id}">${n.flag} ${esc(n.ja)}</button>`).join('');

  $('#sheetBody').innerHTML = `
    <div class="hero">
      <img class="flagimg" src="${flagUrl(c)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'flag',textContent:'${c.flag}'}))">
      <div><h1>${esc(c.ja)}</h1><div class="sub">${esc(c.jaOff)}${c.jaOff ? ' / ' : ''}${esc(c.en)}</div></div>
    </div>
    <div class="tags">${tags.join('')}</div>
    <div class="grid">
      <div class="cell"><div class="k">首都</div><div class="v">${esc(c.cap.join('・') || '—')}</div></div>
      <div class="cell"><div class="k">人口${c.popY ? `（${c.popY}年）` : ''}</div><div class="v">${fmtPop(c.pop)}</div><div class="n">${[rankOf(x => x.pop), popRatio].filter(Boolean).join(' / ')}</div></div>
      <div class="cell"><div class="k">面積</div><div class="v">${fmtArea(c.area)}</div><div class="n">${[rankOf(x => x.area), ratioTxt].filter(Boolean).join(' / ')}</div></div>
      <div class="cell"><div class="k">人口密度</div><div class="v">${d ? fmtNum(d, d < 10 ? 1 : 0) + '人/km²' : '—'}</div><div class="n">${d ? `日本は${fmtNum(dens(jp), 0)}人/km²` : ''}</div></div>
      <div class="cell"><div class="k">公用語</div><div class="v">${esc(c.lang.join('、') || '—')}</div></div>
      <div class="cell"><div class="k">通貨</div><div class="v">${esc(c.cur.join('、') || '—')}</div></div>
      <div class="cell"><div class="k">GDP（名目）</div><div class="v">${fmtUSD(c.gdp)}</div><div class="n">${c.gdp ? rankOf(x => x.gdp) : ''}</div></div>
      <div class="cell"><div class="k">1人あたりGDP</div><div class="v">${pc ? '$' + fmtNum(pc, 0) : '—'}</div></div>
      <div class="cell wide"><div class="k">最高地点</div><div class="v">${c.hp ? esc(c.hp.name) + (c.hp.m ? `（${fmtNum(c.hp.m)} m）` : '') : '—'}</div></div>
      <div class="cell wide"><div class="k">位置</div><div class="v">${c.ll ? latTxt(c.ll[0]) + '　' + lngTxt(c.ll[1]) : '—'}</div>
        <div class="n">${c.capLL ? '東京からの距離（首都まで）約' + fmtNum(Math.round(dist(jp.capLL, c.capLL) / 100) * 100) + ' km' : ''}</div></div>
      <div class="cell wide"><div class="k">となりの国（陸で接する国）${c.borders.length ? '・' + c.borders.length + 'か国' : ''}</div>
        ${nb ? `<div class="nb">${nb}</div>` : '<div class="v muted" style="font-size:14px">なし（島国など）</div>'}</div>
    </div>
    <div class="wiki" id="wiki"><h3>📖 くわしく（ウィキペディアより）</h3><div class="muted">読み込み中…</div></div>`;
  const S = $('#sheet'); S.hidden = false; S.scrollTop = 0;
  hidePanels();
  S.querySelectorAll('[data-go]').forEach(b => b.onclick = () => select(byId[b.dataset.go], true));
  loadWiki(c);
}
const latTxt = v => (v >= 0 ? '北緯' : '南緯') + Math.abs(Math.round(v)) + '度';
const lngTxt = v => (v >= 0 ? '東経' : '西経') + Math.abs(Math.round(v)) + '度';
function dist(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const wikiCache = {};
async function loadWiki(c) {
  const box = () => $('#wiki');
  if (!c.wiki) { box().innerHTML = ''; return; }
  try {
    const j = wikiCache[c.id] || (wikiCache[c.id] = await fetch('https://ja.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(c.wiki)).then(r => r.json()));
    if (selected !== c || !box()) return;
    box().innerHTML = `<h3>📖 くわしく（ウィキペディアより）</h3><div>${esc(j.extract || '')}</div>
      <p><a href="https://ja.wikipedia.org/wiki/${encodeURIComponent(c.wiki)}" target="_blank" rel="noopener">ウィキペディアで続きを読む →</a></p>`;
  } catch {
    if (box()) box().innerHTML = '<span class="muted">（オフラインのため説明を読み込めませんでした）</span>';
  }
}

/* ---------- 検索 ---------- */
function bindUI() {
  const q = $('#q'), R = $('#results');
  let hits = [], hl = 0;
  const kana = s => s.replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60)).toLowerCase();
  q.addEventListener('input', () => {
    const s = kana(q.value.trim());
    if (!s) { R.hidden = true; return; }
    hits = C.filter(c => [c.ja, c.jaOff, c.en, ...c.cap].some(x => x && kana(x).includes(s)))
      .sort((a, b) => (kana(b.ja).startsWith(s) - kana(a.ja).startsWith(s)) || (b.pop || 0) - (a.pop || 0)).slice(0, 12);
    hl = 0;
    R.innerHTML = hits.map((c, i) => `<li data-i="${i}" class="${i === 0 ? 'hl' : ''}">${c.flag} ${esc(c.ja)}<small>${esc(c.cap[0] || '')}</small></li>`).join('') || '<li class="muted">見つかりません</li>';
    R.hidden = false;
  });
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter' && hits[hl]) { go(hits[hl]); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      R.querySelectorAll('li').forEach((li, i) => li.classList.toggle('hl', i === hl)); e.preventDefault();
    }
  });
  R.addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) go(hits[+li.dataset.i]); });
  function go(c) { q.value = ''; R.hidden = true; q.blur(); if (quiz) endQuiz(); select(c, true); }

  document.querySelectorAll('#modes button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $('#tgNames').onchange = updateLabels;
  $('#tgCaps').onchange = updateLabels;
  $('#tgSpin').onchange = e => { globe.controls().autoRotate = e.target.checked; };
  $('#sheetClose').onclick = closeSheet;
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => { if (b.dataset.close === 'quiz') endQuiz(); $('#' + b.dataset.close).hidden = true; });

  $('#btnRank').onclick = () => { const p = $('#rank'); const open = p.hidden; hidePanels(); $('#sheet').hidden = true; p.hidden = !open; if (open) renderRank(); };
  document.querySelectorAll('#rankTabs button').forEach(b => b.onclick = () => { rankK = b.dataset.k; renderRank(); });
  document.querySelectorAll('#rankOrder button').forEach(b => b.onclick = () => { rankO = b.dataset.o; renderRank(); });
  $('#btnQuiz').onclick = () => { const p = $('#quiz'); const open = p.hidden; hidePanels(); closeSheet(); if (open) { p.hidden = false; quizMenu(); } else endQuiz(); };
}
function hidePanels() { $('#rank').hidden = true; if (!quiz) $('#quiz').hidden = true; }
function stopSpin() { $('#tgSpin').checked = false; globe.controls().autoRotate = false; }
function toast(msg, ms = 1600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }

/* ---------- ランキング ---------- */
let rankK = 'pop', rankO = 'desc';
const RANK = {
  pop: { f: c => c.pop, fmt: fmtPop },
  area: { f: c => c.area, fmt: fmtArea },
  dens: { f: dens, fmt: v => fmtNum(v, v < 10 ? 1 : 0) + '人/km²' },
  gdp: { f: c => c.gdp, fmt: fmtUSD },
  gdppc: { f: gdppc, fmt: v => '$' + fmtNum(v, 0) },
  hp: { f: c => c.hp && c.hp.m, fmt: v => fmtNum(v) + ' m', name: c => `${esc(c.ja)} <span class="muted" style="font-size:12px">${esc(c.hp.name)}</span>` },
  nb: { f: c => c.borders.length || null, fmt: v => v + 'か国' },
};
function renderRank() {
  document.querySelectorAll('#rankTabs button').forEach(b => b.classList.toggle('on', b.dataset.k === rankK));
  document.querySelectorAll('#rankOrder button').forEach(b => b.classList.toggle('on', b.dataset.o === rankO));
  const R = RANK[rankK];
  let arr = C.filter(c => c.un && R.f(c) > 0).sort((a, b) => R.f(b) - R.f(a));
  const max = R.f(arr[0]);
  if (rankO === 'asc') arr = arr.reverse();
  arr = arr.slice(0, 30);
  $('#rankList').innerHTML = arr.map(c => `<li data-go="${c.id}"><span>${c.flag}</span>
    <div class="nm">${R.name ? R.name(c) : esc(c.ja)}<div class="barw"><i style="width:${Math.max(1, R.f(c) / max * 100)}%"></i></div></div>
    <span class="val">${R.fmt(R.f(c))}</span></li>`).join('');
  $('#rankList').querySelectorAll('[data-go]').forEach(li => li.onclick = () => select(byId[li.dataset.go], true));
}

/* ---------- クイズ ---------- */
const REGIONS = ['ぜんぶ', 'アジア', 'ヨーロッパ', 'アフリカ', '北アメリカ', '南アメリカ', 'オセアニア'];
let quizRegion = 'ぜんぶ', quizLevel = 'easy';
function quizMenu() {
  quiz = null;
  $('#quiz').classList.remove('mini');
  $('#quizBody').innerHTML = `
    <div class="muted" style="font-size:13px">出題する地域</div>
    <div class="sel" id="qReg">${REGIONS.map(r => `<button class="${r === quizRegion ? 'on' : ''}">${r}</button>`).join('')}</div>
    <div class="muted" style="font-size:13px">むずかしさ</div>
    <div class="sel" id="qLv">
      <button data-l="easy" class="${quizLevel === 'easy' ? 'on' : ''}">かんたん（大きい国・有名な国）</button>
      <button data-l="hard" class="${quizLevel === 'hard' ? 'on' : ''}">むずかしい（すべての国）</button>
    </div>
    <div class="qmenu">
      <button data-t="where"><b>📍 この国はどこ？</b><span>地球儀を回して、その国をタップ</span></button>
      <button data-t="capital"><b>🏛 首都クイズ</b><span>国の首都を4つの中から選ぶ</span></button>
      <button data-t="flag"><b>🚩 国旗クイズ</b><span>国旗を見て国名を当てる</span></button>
      <button data-t="which"><b>🌐 光った国はどこ？</b><span>地球儀で光った国の名前を当てる</span></button>
    </div>`;
  $('#qReg').querySelectorAll('button').forEach(b => b.onclick = () => { quizRegion = b.textContent; quizMenu(); });
  $('#qLv').querySelectorAll('button').forEach(b => b.onclick = () => { quizLevel = b.dataset.l; quizMenu(); });
  $('#quizBody').querySelectorAll('[data-t]').forEach(b => b.onclick = () => startQuiz(b.dataset.t));
}
function quizPool(type) {
  let p = C.filter(c => c.un && (quizRegion === 'ぜんぶ' || c.cont === quizRegion));
  if (type === 'where' || type === 'which') p = p.filter(c => c.hasPoly);
  if (type === 'capital') p = p.filter(c => c.cap.length);
  if (quizLevel === 'easy') {
    const sorted = [...p].sort((a, b) => (b.pop || 0) * Math.sqrt(b.area || 1) - (a.pop || 0) * Math.sqrt(a.area || 1));
    p = sorted.slice(0, Math.max(12, Math.ceil(sorted.length * 0.45)));
  }
  return p;
}
function startQuiz(type) {
  const pool = quizPool(type);
  if (pool.length < 4) { toast('問題にできる国が少なすぎます'); return; }
  // 同じ国が続かないようシャッフルした順に10問
  const order = [...pool].sort(() => Math.random() - 0.5).slice(0, 10);
  quiz = { type, pool, order, i: 0, score: 0, flash: {} };
  closeSheet(); selected = null;
  updateLabels();
  nextQ();
}
function endQuiz() {
  if (!quiz) return;
  quiz = null;
  refreshColors(); updateLabels();
  $('#quiz').classList.remove('mini');
}
function choicesFor(ans, pool, keyFn) {
  const others = pool.filter(c => c !== ans && keyFn(c) !== keyFn(ans));
  // 同じ地域の国を優先して紛らわしい選択肢に
  const near = others.filter(c => c.sub === ans.sub).sort(() => Math.random() - 0.5);
  const far = others.filter(c => c.sub !== ans.sub).sort(() => Math.random() - 0.5);
  const pick = [...near.slice(0, 2), ...far].slice(0, 3);
  return [ans, ...pick].sort(() => Math.random() - 0.5);
}
function nextQ() {
  const q = quiz; if (!q) return;
  if (q.i >= q.order.length) return quizDone();
  const ans = q.cur = q.order[q.i];
  q.flash = {}; q.answered = false;
  const head = `<div class="qhead"><span>第${q.i + 1}問 / ${q.order.length}</span><span>正解 ${q.score}</span></div>`;
  const B = $('#quizBody');
  $('#quiz').classList.toggle('mini', q.type === 'where' || q.type === 'which');

  if (q.type === 'where') {
    B.innerHTML = `${head}<div class="qq">${ans.flag} 「${esc(ans.ja)}」はどこ？</div>
      <div class="muted" style="font-size:13px">地球儀を回して、その国をタップしてね</div>
      <div class="qres" id="qres"></div>
      <div class="qbtns"><button class="btn ghost" id="qSkip">わからない</button></div>`;
    $('#qSkip').onclick = () => quizAnswerWhere(null);
    globe.pointOfView({ altitude: 2.4 }, 800);
  } else {
    let prompt, keyFn, label;
    if (q.type === 'capital') { prompt = `<div class="qq">${ans.flag} ${esc(ans.ja)}の首都は？</div>`; keyFn = c => c.cap[0]; label = c => esc(c.cap[0]); }
    if (q.type === 'flag') { prompt = `<img class="qflagimg" src="${flagUrl(ans, 320)}" alt="" onerror="this.outerHTML='<div class=qflag>${ans.flag}</div>'"><div class="qq" style="text-align:center">この国旗はどこの国？</div>`; keyFn = c => c.ja; label = c => esc(c.ja); }
    if (q.type === 'which') {
      prompt = `<div class="qq">ピンクに光っている国はどこ？</div>`; keyFn = c => c.ja; label = c => `${esc(c.ja)}`;
      q.flash = { [ans.id]: 'rgba(255,60,200,0.95)' };
      flyTo(ans, Math.max(1.2, ans.area > 5e6 ? 2 : 1.4));
    }
    const ch = choicesFor(ans, q.pool.length >= 4 ? q.pool : C.filter(c => c.un), keyFn);
    B.innerHTML = `${head}${prompt}<div class="choices">${ch.map(c => `<button data-id="${c.id}">${label(c)}</button>`).join('')}</div>
      <div class="qres" id="qres"></div><div class="qbtns" id="qbtns"></div>`;
    B.querySelectorAll('.choices button').forEach(b => b.onclick = () => quizAnswerChoice(byId[b.dataset.id], keyFn));
  }
  refreshColors();
}
function quizAnswerChoice(c, keyFn) {
  const q = quiz; if (!q || q.answered) return;
  q.answered = true;
  const ans = q.cur, ok = keyFn(c) === keyFn(ans);
  if (ok) q.score++;
  document.querySelectorAll('.choices button').forEach(b => {
    const bc = byId[b.dataset.id];
    if (keyFn(bc) === keyFn(ans)) b.classList.add('ok'); else if (bc === c) b.classList.add('ng');
  });
  q.flash = { [ans.id]: ok ? 'rgba(61,220,132,0.85)' : 'rgba(255,204,51,0.9)' };
  refreshColors();
  if (q.type !== 'which') flyTo(ans);
  const extra = q.type === 'capital' ? `${esc(ans.ja)}の首都は<b>${esc(ans.cap[0])}</b>` : `正解は<b>${ans.flag} ${esc(ans.ja)}</b>（首都：${esc(ans.cap[0] || '—')}）`;
  $('#qres').innerHTML = (ok ? '<span class="ok">⭕ 正解！</span> ' : '<span class="ng">❌ ざんねん</span> ') + extra;
  showNextBtns(ans);
}
function quizAnswerWhere(c) {
  const q = quiz; if (!q || q.answered) return;
  const ans = q.cur;
  q.answered = true;
  const ok = c === ans;
  if (ok) q.score++;
  q.flash = { [ans.id]: 'rgba(61,220,132,0.9)' };
  if (c && !ok) q.flash[c.id] = 'rgba(255,92,108,0.85)';
  refreshColors();
  flyTo(ans, ans.area > 5e6 ? 1.8 : 1.3);
  $('#qres').innerHTML = ok ? '<span class="ok">⭕ 正解！</span>'
    : `<span class="ng">❌ ${c ? `そこは${esc(c.ja)}` : 'ここでした'}</span> → 緑の国が${esc(ans.ja)}`;
  $('#qSkip').remove();
  showNextBtns(ans);
}
function showNextBtns(ans) {
  const box = document.querySelector('#quizBody .qbtns');
  box.innerHTML = `<button class="btn ghost" id="qInfo">この国を見る</button><button class="btn" id="qNext">${quiz.i + 1 >= quiz.order.length ? '結果を見る' : '次の問題 →'}</button>`;
  $('#qNext').onclick = () => { quiz.i++; nextQ(); };
  $('#qInfo').onclick = () => { endQuiz(); $('#quiz').hidden = true; select(ans, true); };
}
function quizDone() {
  const q = quiz, n = q.order.length, s = q.score;
  const msg = s === n ? '🎉 パーフェクト！地理マスター！' : s >= n * 0.7 ? '👏 すごい！' : s >= n * 0.4 ? '👍 いい調子！' : '💪 もう一回やってみよう';
  const best = +(safeGet('best-' + q.type + quizRegion + quizLevel) || 0);
  if (s > best) safeSet('best-' + q.type + quizRegion + quizLevel, s);
  q.flash = {}; refreshColors();
  $('#quiz').classList.remove('mini');
  $('#quizBody').innerHTML = `<div style="text-align:center;padding:20px 0">
      <div style="font-size:48px;font-weight:900">${s} / ${n}</div>
      <div style="font-size:18px;margin-top:8px">${msg}</div>
      <div class="muted" style="margin-top:6px;font-size:13px">これまでの最高：${Math.max(best, s)} / ${n}${s > best && best ? '（記録更新！）' : ''}</div></div>
    <div class="qbtns"><button class="btn ghost" id="qMenu">メニュー</button><button class="btn" id="qAgain">もう一回</button></div>`;
  const t = q.type;
  $('#qAgain').onclick = () => startQuiz(t);
  $('#qMenu').onclick = () => { endQuiz(); quizMenu(); };
}
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { } }
