// Token Launch Radar — page logic. Reads window.RADAR (written beside this
// page as data.js by the entry program) and renders the board, the filters,
// the per-protocol detail view and the already-trading comparison table.
// No network, no framework: the snapshot's numbers and nothing else.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) return;

  var $ = function (id) { return document.getElementById(id); };
  var rowsEl = $('rows'), liveEl = $('live-rows'), detailEl = $('detail');

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // Header stats.
  var totalImplied = R.rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  $('stats').innerHTML =
    '<div><dt>Protocols scanned</dt><dd>' + R.protocol_count + '</dd></div>' +
    '<div><dt>Pre-token found</dt><dd>' + R.pre_token_count + '</dd></div>' +
    '<div><dt>On the board</dt><dd>' + R.rows.length + '</dd></div>' +
    '<div><dt>Combined implied</dt><dd>' + money(totalImplied) + '</dd></div>';
  $('asof').textContent = R.as_of;

  // Filter option lists, from the board itself.
  function fillSelect(el, values, allLabel) {
    el.innerHTML = '<option value="">' + allLabel + '</option>' + values.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    }).join('');
  }
  var cats = [], chains = [], seenC = {}, seenH = {};
  R.rows.forEach(function (r) {
    if (r.category && !seenC[r.category]) { seenC[r.category] = 1; cats.push(r.category); }
    r.chains.forEach(function (c) { if (!seenH[c]) { seenH[c] = 1; chains.push(c); } });
  });
  cats.sort(); chains.sort();
  fillSelect($('cat'), cats, 'All categories');
  fillSelect($('chain'), chains, 'All chains');

  var selected = null;

  function visibleRows() {
    var q = $('q').value.trim().toLowerCase();
    var cat = $('cat').value, chain = $('chain').value;
    var wlOnly = $('wl').checked;
    var out = R.rows.filter(function (r) {
      if (wlOnly && !r.watchlist) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) === -1) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      return true;
    });
    var sort = $('sort').value;
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || -1e9) - (a.change_7d || -1e9); },
      age: function (a, b) { return (b.age_days || -1) - (a.age_days || -1); }
    }[sort];
    return out.sort(by);
  }

  function render() {
    var rows = visibleRows();
    $('count').textContent = rows.length + ' of ' + R.rows.length + ' board protocols shown. Click a row for its model working and farm plan.';
    rowsEl.innerHTML = rows.map(function (r) {
      var ratio = r.tvl_usd > 0 ? r.implied_value_usd / r.tvl_usd : 0;
      var pctCls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
      return '<tr data-slug="' + esc(r.slug) + '"' + (selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="badge">watchlist</span>' : '') +
        '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctCls + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + (r.age_days === null ? '—' : r.age_days + 'd') + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '<td><span class="ratio"><span class="bar"><span class="fill" style="width:' + Math.min(100, ratio * 60) + '%"></span></span>' + ratio.toFixed(2) + 'x</span></td>' +
        '</tr>';
    }).join('');
  }

  function showDetail(slug) {
    var r = null;
    R.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) { detailEl.hidden = true; return; }
    selected = slug;
    detailEl.hidden = false;
    detailEl.innerHTML =
      '<h2>#' + r.rank + ' ' + esc(r.name) + (r.watchlist ? '<span class="badge">watchlist</span>' : '') + '</h2>' +
      '<p class="sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) +
      ' · tier: ' + (r.tier === 'anchor' ? 'anchor (at or above the $50M floor)' : 'radar (below the floor)') + '</p>' +
      '<dl class="factors">' +
      '<div><dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd></div>' +
      '<div><dt>Category multiple</dt><dd>&times;' + r.multiple.toFixed(2) + '<small>share of TVL a launch might be worth</small></dd></div>' +
      '<div><dt>Growth factor</dt><dd>&times;' + r.growth_factor.toFixed(2) + '<small>from the 7d TVL change of ' + pct(r.change_7d) + '</small></dd></div>' +
      '<div><dt>Maturity factor</dt><dd>&times;' + r.maturity_factor.toFixed(2) + '<small>' + (r.age_days === null ? 'no start date recorded' : r.age_days + ' days tracked, no token') + '</small></dd></div>' +
      '<div><dt>Implied value</dt><dd>' + money(r.implied_value_usd) + '<small>the model\u2019s claim, not a forecast</small></dd></div>' +
      '</dl>' +
      '<h3>Farm plan</h3>' +
      '<ol>' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    render();
    detailEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  rowsEl.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  ['q', 'cat', 'chain', 'sort', 'wl'].forEach(function (id) {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });

  // Already-trading comparison table.
  liveEl.innerHTML = R.live.map(function (r) {
    return '<tr><td><span class="pname">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.symbol || '—') + '</td>' +
      '<td class="num">' + money(r.mcap_usd) + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num">' + r.mcap_to_tvl.toFixed(2) + 'x</td></tr>';
  }).join('');

  // View tabs.
  function setView(live) {
    $('board-view').hidden = live;
    $('live-view').hidden = !live;
    $('tab-board').classList.toggle('active', !live);
    $('tab-live').classList.toggle('active', live);
  }
  $('tab-board').addEventListener('click', function () { setView(false); });
  $('tab-live').addEventListener('click', function () { setView(true); });

  render();
})();
