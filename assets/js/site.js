/* 时间序列实验室 · 站点外壳与通用组件（全局对象 Site）
 *
 * ★ CHAPTERS 是全站章节的唯一数据源。
 *   新增一章 = 在 chapters/ 放一个 html（复制任意一章改内容） + 在下面加一行。
 *   顶栏、侧栏目录、上一章/下一章、首页卡片、学习进度都由它自动生成。
 */
(function (g) {
  'use strict';

  const CHAPTERS = [
    { id: '01', file: '01-basics.html',       part: '基础篇',   title: '认识时间序列',         desc: '什么是时间序列、四种成分、业务里的预测问题长什么样', min: 20 },
    { id: '02', file: '02-eda.html',          part: '基础篇',   title: '探索分析与分解',       desc: '移动平均、季节图、趋势-季节-残差分解、滞后图', min: 20 },
    { id: '03', file: '03-cleaning.html',     part: '基础篇',   title: '脏数据诊断与清洗',     desc: '缺失、重复、异常、缺货截断、口径突变……真实数据怎么治', min: 30 },
    { id: '04', file: '04-stationarity.html', part: '基础篇',   title: '平稳性、差分与自相关', desc: '白噪声、随机游走、ADF 检验、ACF / PACF', min: 25 },
    { id: '05', file: '05-evaluation.html',   part: '基础篇',   title: '预测基线与评估',       desc: '基线模型、滚动回测、评估指标、预测区间与业务成本', min: 25 },
    { id: '06', file: '06-smoothing.html',    part: '统计模型', title: '指数平滑',             desc: 'SES、Holt、Holt-Winters 与 ETS 家族', min: 20 },
    { id: '07', file: '07-arima.html',        part: '统计模型', title: 'ARIMA 家族',           desc: 'AR、MA、差分、定阶、SARIMA 与残差诊断', min: 35 },
    { id: '08', file: '08-ml.html',           part: '机器学习', title: '机器学习预测',         desc: '特征工程、决策树、随机森林、GBDT / XGBoost / LightGBM', min: 40 },
    { id: '09', file: '09-nn.html',           part: '深度学习', title: '神经网络基础',         desc: '神经元、梯度下降、反向传播、MLP', min: 25 },
    { id: '10', file: '10-lstm.html',         part: '深度学习', title: 'LSTM',                 desc: '从 RNN 到 LSTM：门控、细胞状态与浏览器内现场训练', min: 35 },
    { id: '11', file: '11-transformer.html',  part: '深度学习', title: '注意力与 Transformer', desc: '注意力机制、分块（PatchTST）思路与时序大模型', min: 30 },
    { id: '12', file: '12-business.html',     part: '业务实战', title: '业务实战与模型竞技场', desc: '多模型回测排行榜，补货、负荷、监控、促销四个案例', min: 40 },
    { id: '13', file: '13-cheatsheet.html',   part: '业务实战', title: '速查手册',             desc: '方法对比表、术语表、清洗清单、Python 库速查', min: 10 },
  ];

  const Site = { CHAPTERS };
  const body = document.body;
  const chId = body.dataset.ch || null;
  const ROOT = chId ? '../' : '';
  const cur = CHAPTERS.find(c => c.id === chId) || null;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  Site.esc = esc;

  /* ---------- 本地存储（隐私模式下可能不可用，全部兜底） ---------- */
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* 忽略 */ } },
  };
  const getDone = () => { try { return JSON.parse(ls.get('tsl-done') || '[]'); } catch (e) { return []; } };
  const setDone = a => ls.set('tsl-done', JSON.stringify(a));

  /* ---------- 主题 ---------- */
  const themeFns = [];
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    if (t) return t === 'dark';
    return !!(g.matchMedia && g.matchMedia('(prefers-color-scheme: dark)').matches);
  };
  let palCache = null;
  function pal() {
    if (palCache) return palCache;
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim();
    const dark = isDark();
    palCache = {
      dark,
      s: [1, 2, 3, 4, 5, 6, 7, 8].map(i => v('--s' + i)),
      ink: v('--ink'), ink2: v('--ink2'), muted: v('--muted'), grid: v('--line'), axis: v('--axis'),
      surface: v('--surface'), surface2: v('--surface-2'), accent: v('--accent'),
      good: v('--good'), warn: v('--warn'), serious: v('--serious'), crit: v('--crit'),
      // 顺序色带（单一蓝色，接近 0 的一端向底色退隐）
      seq: dark ? ['#1a1a19', '#0d366b', '#184f95', '#256abf', '#5598e7', '#b7d3f6']
                : ['#fcfcfb', '#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'],
      // 发散色带（蓝 ↔ 红，中点为中性灰）
      div: dark ? ['#e66767', '#8a4a48', '#383835', '#2c5a94', '#3987e5']
                : ['#e34948', '#f0b7b2', '#f0efec', '#a9c9f2', '#2a78d6'],
    };
    return palCache;
  }
  Site.pal = pal;
  Site.onTheme = fn => themeFns.push(fn);
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    ls.set('tsl-theme', t);
    palCache = null;
    themeFns.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  }

  /* ---------- 数字格式 ---------- */
  Site.fmt = function (v, d) {
    if (v == null || Number.isNaN(v)) return '—';
    if (typeof v !== 'number') return String(v);
    if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
    const a = Math.abs(v);
    if (d == null) d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 3;
    return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
  };
  Site.pct = (v, d) => (v == null || !Number.isFinite(v)) ? '—' : (v * 100).toFixed(d == null ? 1 : d) + '%';

  /* ---------- 外壳：顶栏 / 侧栏 / 章节头尾 ---------- */
  function buildChrome() {
    const main = $('main');
    const done = getDone();
    const top = document.createElement('header');
    top.className = 'topbar';
    top.innerHTML =
      (cur ? '<button class="icon-btn" id="navBtn" aria-label="打开目录">☰</button>' : '') +
      `<a class="brand" href="${ROOT}index.html">📈 时间序列实验室</a>` +
      (cur ? `<span class="crumb">/ ${cur.id} ${esc(cur.title)}</span>` : '') +
      '<span class="spacer"></span>' +
      '<button class="icon-btn" id="themeBtn" aria-label="切换深色/浅色" title="切换深色/浅色">◐</button>' +
      '<div class="read-bar"><i></i></div>';
    body.insertBefore(top, body.firstChild);
    $('#themeBtn').onclick = () => setTheme(isDark() ? 'light' : 'dark');

    const layout = document.createElement('div');
    layout.className = 'layout' + (cur ? '' : ' home');
    main.parentNode.insertBefore(layout, main);

    if (cur) {
      // 侧栏
      const side = document.createElement('aside');
      side.className = 'sidebar'; side.id = 'sidebar';
      let h = `<nav><a href="${ROOT}index.html">🏠 首页 · 学习路线</a>`;
      let part = '';
      CHAPTERS.forEach(c => {
        if (c.part !== part) { part = c.part; h += `<div class="nav-part">${part}</div>`; }
        const cls = 'nav-ch' + (c.id === chId ? ' cur' : '') + (done.includes(c.id) ? ' done' : '');
        h += `<a class="${cls}" data-id="${c.id}" href="${ROOT}chapters/${c.file}"><span class="num">${c.id}</span><span>${esc(c.title)}</span></a>`;
        if (c.id === chId) {
          const secs = $$('section[id] > h2', main);
          if (secs.length) h += '<div class="nav-toc">' + secs.map(x => `<a href="#${x.parentNode.id}">${esc(x.textContent)}</a>`).join('') + '</div>';
        }
      });
      side.innerHTML = h + '</nav>';
      const scrim = document.createElement('div'); scrim.className = 'scrim';
      layout.appendChild(side); layout.appendChild(main); body.appendChild(scrim);
      const toggle = on => { side.classList.toggle('open', on); scrim.classList.toggle('open', on); };
      $('#navBtn').onclick = () => toggle(!side.classList.contains('open'));
      scrim.onclick = () => toggle(false);
      side.addEventListener('click', e => { if (e.target.closest('a')) toggle(false); });

      // 章节头
      const idx = CHAPTERS.indexOf(cur);
      const head = document.createElement('header');
      head.className = 'ch-head';
      head.innerHTML = `<div class="eyebrow">第 ${cur.id} 章 · ${cur.part} · 约 ${cur.min} 分钟</div><h1>${esc(cur.title)}</h1>`;
      main.insertBefore(head, main.firstChild);
      document.title = `${cur.id} ${cur.title} · 时间序列实验室`;

      // 章节尾：标记完成 + 上一章/下一章
      const prev = CHAPTERS[idx - 1], next = CHAPTERS[idx + 1];
      const foot = document.createElement('footer');
      foot.className = 'ch-foot';
      foot.innerHTML = '<button class="btn" id="doneBtn"></button><div class="pn">' +
        (prev ? `<a class="prev" href="${prev.file}"><small>← 上一章</small>${prev.id} ${esc(prev.title)}</a>` : '<span style="flex:1"></span>') +
        (next ? `<a class="next" href="${next.file}"><small>下一章 →</small>${next.id} ${esc(next.title)}</a>` : `<a class="next" href="${ROOT}index.html"><small>完成 🎉</small>回到首页</a>`) +
        '</div>';
      main.appendChild(foot);
      const btn = $('#doneBtn');
      const paint = () => {
        const on = getDone().includes(chId);
        btn.textContent = on ? '✓ 本章已学完（点击取消）' : '标记本章已学完';
        btn.classList.toggle('done', on);
        const a = $(`.nav-ch[data-id="${chId}"]`); if (a) a.classList.toggle('done', on);
      };
      btn.onclick = () => { let d = getDone(); d = d.includes(chId) ? d.filter(x => x !== chId) : d.concat(chId); setDone(d); paint(); };
      paint();

      // 目录高亮
      if (g.IntersectionObserver) {
        const links = {}; $$('.nav-toc a', side).forEach(a => { links[a.getAttribute('href').slice(1)] = a; });
        const io = new IntersectionObserver(es => {
          es.forEach(e => { if (e.isIntersecting) { Object.values(links).forEach(a => a.classList.remove('on')); const a = links[e.target.id]; if (a) a.classList.add('on'); } });
        }, { rootMargin: '-20% 0px -70% 0px' });
        $$('section[id]', main).forEach(s => io.observe(s));
      }
    } else {
      layout.appendChild(main);
    }

    // 阅读进度条
    const bar = $('.read-bar i');
    const onScroll = () => { const h = document.documentElement; const m = h.scrollHeight - h.clientHeight; bar.style.width = (m > 0 ? h.scrollTop / m * 100 : 0) + '%'; };
    g.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }

  /* ---------- 公式与代码块 ---------- */
  Site.math = function (el) {
    if (!g.renderMathInElement) return;
    g.renderMathInElement(el || document.body, {
      delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
      throwOnError: false,
    });
  };
  function enhanceCode() {
    $$('details.code pre').forEach(pre => {
      const wrap = document.createElement('div'); wrap.className = 'pre-wrap';
      pre.parentNode.insertBefore(wrap, pre); wrap.appendChild(pre);
      const b = document.createElement('button'); b.className = 'copy-btn'; b.textContent = '复制';
      b.onclick = () => {
        const t = pre.textContent;
        const ok = () => { b.textContent = '已复制'; setTimeout(() => { b.textContent = '复制'; }, 1200); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, () => {});
        else { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); try { document.execCommand('copy'); ok(); } catch (e) { /* 忽略 */ } }
      };
      wrap.appendChild(b);
    });
  }

  /* ---------- 图表：主题化的 ECharts 选项 ---------- */
  const merge = (a, b) => Object.assign({}, a, b || {});
  const col = c => (typeof c === 'number' ? pal().s[c] : c);
  Site.col = col;

  // 系列快捷构造：S.line('销量', y, {c:0})   c 为调色板槽位(0-7)或颜色字符串
  const S = Site.S = {
    line(name, data, o) {
      o = o || {}; const c = col(o.c == null ? 0 : o.c);
      const s = {
        type: 'line', name, data, showSymbol: !!o.sym, symbolSize: o.symSize || 6, connectNulls: !!o.connect,
        smooth: !!o.smooth, step: o.step || false, z: o.z || 2,
        lineStyle: { width: o.w == null ? 2 : o.w, color: c, type: o.dash ? 'dashed' : 'solid', opacity: o.op == null ? 1 : o.op },
        itemStyle: { color: c },
      };
      if (o.area) s.areaStyle = { color: c, opacity: o.area === true ? 0.12 : o.area };
      return Object.assign(s, o.x || {});
    },
    bar(name, data, o) {
      o = o || {}; const c = col(o.c == null ? 0 : o.c);
      return Object.assign({ type: 'bar', name, data, itemStyle: { color: c, borderRadius: 2, opacity: o.op == null ? 1 : o.op }, barMaxWidth: o.maxW || 28 }, o.x || {});
    },
    scatter(name, data, o) {
      o = o || {}; const c = col(o.c == null ? 0 : o.c);
      return Object.assign({ type: 'scatter', name, data, symbolSize: o.size || 7, z: o.z || 3, itemStyle: { color: c, opacity: o.op == null ? 0.85 : o.op, borderColor: pal().surface, borderWidth: o.ring === false ? 0 : 1 } }, o.x || {});
    },
    // 区间带（预测区间）：返回两个以 "_" 开头的隐藏系列
    band(lo, hi, o) {
      o = o || {}; const c = col(o.c == null ? 0 : o.c); const id = '_b' + (S._n = (S._n || 0) + 1);
      const base = { type: 'line', showSymbol: false, lineStyle: { opacity: 0 }, stack: id, stackStrategy: 'all', silent: true, z: 1 };
      return [
        Object.assign({ name: id + 'lo', data: lo }, base),
        Object.assign({ name: id + 'hi', data: hi.map((v, i) => (v == null || lo[i] == null || Number.isNaN(v) || Number.isNaN(lo[i])) ? null : v - lo[i]), areaStyle: { color: c, opacity: o.op == null ? 0.16 : o.op } }, base),
      ];
    },
    // 竖线标记 / 区域阴影：挂在任意一个系列上
    vline(xs, o) {
      o = o || {};
      return { symbol: 'none', silent: true, animation: false, lineStyle: { color: col(o.c == null ? pal().muted : o.c), type: 'dashed', width: 1 },
        label: { show: !!o.label, formatter: o.label || '', color: pal().ink2, fontSize: 11, position: o.pos || 'insideEndTop' },
        data: [].concat(xs).map(x => ({ xAxis: x })) };
    },
    hline(ys, o) {
      o = o || {};
      return { symbol: 'none', silent: true, animation: false, lineStyle: { color: col(o.c == null ? pal().muted : o.c), type: 'dashed', width: 1 },
        label: { show: !!o.label, formatter: o.label || '', color: pal().ink2, fontSize: 11, position: 'insideEndTop' },
        data: [].concat(ys).map(y => ({ yAxis: y })) };
    },
    areas(list) { // list: [[x0, x1, 标签?, 颜色?], ...]
      return { silent: true, animation: false,
        data: list.map(a => [{ xAxis: a[0], name: a[2] || '', itemStyle: { color: col(a[3] == null ? pal().muted : a[3]), opacity: 0.1 }, label: { color: pal().ink2, fontSize: 11, position: 'insideTop' } }, { xAxis: a[1] }]) };
    },
  };

  function themed(o) {
    const p = pal();
    o = Object.assign({}, o);
    const axis = (a, isY) => {
      a = a || {};
      const isVal = (a.type || (isY ? 'value' : 'category')) !== 'category';
      return Object.assign({}, a, {
        type: a.type || (isY ? 'value' : 'category'),
        axisLine: merge({ show: !isY, lineStyle: { color: p.axis } }, a.axisLine),
        axisTick: merge({ show: false }, a.axisTick),
        // 类别很少（柱状图的几个模型名）时全部显示；否则自动隐藏重叠的刻度文字
        axisLabel: merge(!isVal && a.data && a.data.length <= 6 ? { color: p.muted, fontSize: 11, interval: 0 } : { color: p.muted, fontSize: 11, hideOverlap: true }, a.axisLabel),
        splitLine: merge({ show: isY || isVal, lineStyle: { color: p.grid } }, a.splitLine),
        nameTextStyle: merge(isY ? { color: p.muted, fontSize: 11, align: 'right' } : { color: p.muted, fontSize: 11 }, a.nameTextStyle),
        scale: a.scale == null ? isVal : a.scale,
      });
    };
    const mapAx = (v, isY) => Array.isArray(v) ? v.map(a => axis(a, isY)) : axis(v, isY);
    const nonCart = ['pie', 'graph', 'radar', 'sankey', 'treemap', 'gauge', 'funnel'];
    if (o.xAxis !== undefined || o.yAxis !== undefined || (o.series || []).some(s => !nonCart.includes(s.type))) {
      o.xAxis = mapAx(o.xAxis, false); o.yAxis = mapAx(o.yAxis, true);
    }
    const series = o.series || [];
    const names = []; series.forEach(s => { if (s.name && s.name[0] !== '_' && !names.includes(s.name)) names.push(s.name); });
    const showLegend = o.legend !== false && (o.legend || names.length >= 2);
    if (showLegend) {
      o.legend = merge({ top: 0, left: 0, type: 'scroll', data: names, itemWidth: 16, itemHeight: 8, itemGap: 14, icon: 'roundRect',
        textStyle: { color: p.ink2, fontSize: 12 }, pageIconColor: p.ink2, pageTextStyle: { color: p.muted }, inactiveColor: p.axis }, o.legend === true ? {} : o.legend);
    } else delete o.legend;
    // 顶部留白：图例一行 + （如果有）纵轴名称一行，互不重叠
    const yNamed = [].concat(o.yAxis || []).some(a => a && a.name), top = (showLegend ? 30 : 8) + (yNamed ? 22 : 6);
    if (o.grid === undefined) o.grid = { left: 6, right: 14, top, bottom: o.dataZoom ? 46 : 6, containLabel: true };
    else if (Array.isArray(o.grid)) o.grid = o.grid.map(x => merge({ containLabel: true, left: 6, right: 14 }, x));
    else o.grid = merge({ left: 6, right: 14, top, bottom: 6, containLabel: true }, o.grid);
    if (o.tooltip !== false) {
      const tt = merge({ trigger: 'axis', confine: true }, o.tooltip);
      o.tooltip = merge({
        backgroundColor: p.surface, borderColor: p.grid, borderWidth: 1, padding: [6, 10],
        textStyle: { color: p.ink, fontSize: 12 }, axisPointer: { type: 'line', lineStyle: { color: p.axis }, label: { show: false } },
        formatter: tt.trigger === 'axis' ? function (ps) {
          ps = [].concat(ps).filter(q => q.seriesName && q.seriesName[0] !== '_');
          if (!ps.length) return '';
          let h = `<div style="color:${p.muted};margin-bottom:2px">${esc(ps[0].axisValueLabel != null ? ps[0].axisValueLabel : ps[0].name)}</div>`;
          ps.forEach(q => {
            let v = Array.isArray(q.value) ? q.value[q.value.length - 1] : q.value;
            if (v == null || v === '-' || Number.isNaN(v)) return;
            h += `<div>${q.marker}${esc(q.seriesName)}　<b>${Site.fmt(+v)}</b></div>`;
          });
          return h;
        } : undefined,
      }, tt);
    } else delete o.tooltip;
    if (o.dataZoom === true) o.dataZoom = [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 6, borderColor: p.grid, fillerColor: 'rgba(120,120,120,.18)', handleSize: '90%', showDetail: false, brushSelect: false, dataBackground: { lineStyle: { color: p.axis }, areaStyle: { color: p.axis, opacity: .3 } } }];
    if (o.visualMap) o.visualMap = [].concat(o.visualMap).map(v => merge({ textStyle: { color: p.muted, fontSize: 11 }, itemWidth: 12, itemHeight: 90 }, v));
    o.color = o.color || p.s;
    o.backgroundColor = 'transparent';
    o.textStyle = merge({ color: p.ink2, fontFamily: 'system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif' }, o.textStyle);
    if (o.animation === undefined) o.animation = false;
    if (o.title) o.title = [].concat(o.title).map(t => merge({ textStyle: { color: p.ink2, fontSize: 12, fontWeight: 600 }, left: 6 }, t));
    return o;
  }
  Site.themed = themed;

  const allCharts = new Set();
  function mountChart(el) {
    if (el.dataset.h) el.style.height = el.dataset.h + 'px';
    const c = g.echarts.init(el);
    allCharts.add(c);
    return c;
  }
  let rsT = null;
  g.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(() => allCharts.forEach(c => c.resize()), 120); });

  /* ---------- 互动实验 Site.demo(id, {controls, setup, render}) ----------
   * HTML 约定：
   *   <div class="demo" id="xxx"><div class="demo-title">…</div><div class="demo-body">
   *     <div class="ctl"></div> <div class="chart"></div> <div class="readout"></div> </div></div>
   * controls: [{k,label,type:'range'|'select'|'seg'|'check'|'checks', ...}, {act,label,run(state,d)}]
   * render(state, d): 用 d.chart(i, option) / d.out(html, i) 画图和输出
   */
  const demos = [];
  let io = null;
  Site.demo = function (id, spec) {
    const root = document.getElementById(id);
    if (!root) { console.warn('[Site.demo] 找不到容器 #' + id); return null; }
    const d = { id, root, spec, state: {}, inited: false, _charts: new Map(), _raf: 0, _run: {} };
    const s = d.state;
    const ctlBox = $('.ctl', root);
    const setters = {};
    let btnBox = null;

    (spec.controls || []).forEach(c => {
      if (c.act) {
        if (!btnBox) { btnBox = document.createElement('div'); btnBox.className = 'btns'; ctlBox.appendChild(btnBox); }
        const b = document.createElement('button');
        b.className = 'btn' + (c.primary ? ' primary' : ''); b.textContent = c.label; b.dataset.act = c.act;
        b.onclick = () => { const r = c.run ? c.run(s, d, b) : null; if (r !== false) d.render(); };
        btnBox.appendChild(b); return;
      }
      btnBox = null;
      const type = c.type || 'range';
      if (type === 'range') {
        s[c.k] = c.value;
        const f = document.createElement('label'); f.className = 'f';
        f.innerHTML = `<span class="lab"><span>${c.label}</span><b></b></span><input type="range" min="${c.min}" max="${c.max}" step="${c.step == null ? 1 : c.step}" value="${c.value}">`;
        const inp = $('input', f), out = $('b', f);
        const show = () => { out.textContent = c.fmt ? c.fmt(s[c.k]) : s[c.k] + (c.unit || ''); };
        inp.addEventListener('input', () => { s[c.k] = +inp.value; show(); d.render(c.k); });
        setters[c.k] = v => { s[c.k] = v; inp.value = v; show(); };
        show(); ctlBox.appendChild(f);
      } else if (type === 'select') {
        s[c.k] = c.value == null ? c.options[0][0] : c.value;
        const f = document.createElement('label'); f.className = 'f';
        f.innerHTML = `<span class="lab"><span>${c.label}</span></span><select>${c.options.map((o, i) => `<option value="${i}">${esc(o[1])}</option>`).join('')}</select>`;
        const sel = $('select', f);
        sel.value = String(Math.max(0, c.options.findIndex(o => o[0] === s[c.k])));
        sel.addEventListener('change', () => { s[c.k] = c.options[+sel.value][0]; d.render(c.k); });
        setters[c.k] = v => { s[c.k] = v; sel.value = String(c.options.findIndex(o => o[0] === v)); };
        ctlBox.appendChild(f);
      } else if (type === 'seg') {
        s[c.k] = c.value == null ? c.options[0][0] : c.value;
        const f = document.createElement('div'); f.className = 'f';
        f.innerHTML = `<span class="lab"><span>${c.label}</span></span><div class="seg">${c.options.map((o, i) => `<button type="button" data-i="${i}">${esc(o[1])}</button>`).join('')}</div>`;
        const bs = $$('button', f);
        const paint = () => bs.forEach((b, i) => b.classList.toggle('on', c.options[i][0] === s[c.k]));
        bs.forEach((b, i) => { b.onclick = () => { s[c.k] = c.options[i][0]; paint(); d.render(c.k); }; });
        setters[c.k] = v => { s[c.k] = v; paint(); };
        paint(); ctlBox.appendChild(f);
      } else if (type === 'check') {
        s[c.k] = !!c.value;
        const f = document.createElement('label'); f.className = 'chk';
        f.innerHTML = `<input type="checkbox"${c.value ? ' checked' : ''}><span>${c.label}</span>`;
        const inp = $('input', f);
        inp.addEventListener('change', () => { s[c.k] = inp.checked; d.render(c.k); });
        setters[c.k] = v => { s[c.k] = !!v; inp.checked = !!v; };
        ctlBox.appendChild(f);
      } else if (type === 'checks') { // 一组复选框，state[k] 是 {子键: bool}
        s[c.k] = {};
        const f = document.createElement('div'); f.className = 'chks';
        f.innerHTML = (c.label ? `<span class="lab0">${c.label}</span>` : '') + c.options.map((o, i) => `<label class="chk"><input type="checkbox" data-i="${i}"${o[2] ? ' checked' : ''}><span>${o[1]}</span></label>`).join('');
        c.options.forEach(o => { s[c.k][o[0]] = !!o[2]; });
        $$('input', f).forEach(inp => inp.addEventListener('change', () => { s[c.k][c.options[+inp.dataset.i][0]] = inp.checked; d.render(c.k); }));
        ctlBox.appendChild(f);
      }
    });

    d.set = (k, v) => { if (setters[k]) setters[k](v); else s[k] = v; };
    d.el = sel => $(sel, root);
    d.btn = act => $(`[data-act="${act}"]`, root);
    d.chart = (i, option, raw) => {
      const el = $$('.chart', root)[i];
      if (!el) { console.warn(`[Site.demo] #${id} 没有第 ${i} 个 .chart`); return null; }
      let c = d._charts.get(el);
      if (!c) { c = mountChart(el); d._charts.set(el, c); }
      c.setOption(raw ? option : themed(option), { notMerge: true });
      return c;
    };
    d.out = (html, i) => { const el = $$('.readout', root)[i || 0]; if (el) el.innerHTML = html; };
    d.draw = (changed) => { try { spec.render(s, d, changed); } catch (e) { console.error('[demo ' + id + ']', e); d.out(`<span class="tag bad">出错了：${esc(e.message)}</span>`); } };
    d.render = (changed) => {
      if (!d.inited) return;
      if (d._raf) return;
      d._raf = requestAnimationFrame(() => { d._raf = 0; d.draw(changed); });
    };
    // 可中止的循环（动画 / 训练）：再次调用同一个 key 即停止。step() 返回 false 表示结束。
    d.loop = (key, step, delay, onStop) => {
      if (d._run[key]) { d._run[key] = false; return false; }
      d._run[key] = true;
      const tick = () => {
        if (!d._run[key]) { if (onStop) onStop(); return; }
        let cont; try { cont = step(); } catch (e) { console.error(e); cont = false; }
        if (cont === false) { d._run[key] = false; if (onStop) onStop(); return; }
        setTimeout(tick, delay || 0);
      };
      tick(); return true;
    };
    d.stop = key => { d._run[key] = false; };
    d.init = () => {
      if (d.inited) return; d.inited = true;
      try { if (spec.setup) spec.setup(s, d); } catch (e) { console.error('[demo ' + id + ' setup]', e); }
      d.draw();
    };
    demos.push(d);
    if (g.IntersectionObserver) {
      if (!io) io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); const x = demos.find(q => q.root === e.target); if (x) x.init(); } }), { rootMargin: '500px 0px' });
      io.observe(root);
    } else d.init();
    return d;
  };
  Site.onTheme(() => demos.forEach(d => { if (d.inited) d.draw('theme'); }));
  Site.demos = demos;
  Site.initAll = () => demos.forEach(d => d.init()); // 调试/自检用：不等滚动到视口，立即初始化全部实验
  // 页面自检：在浏览器控制台运行 Site.selfTest()。把每个实验的每个控件拨到各个取值、每个按钮点一次，收集报错。
  Site.selfTest = function () {
    const errs = [], oe = console.error;
    console.error = function () { errs.push(Array.from(arguments).map(x => (x && x.message) || String(x)).join(' ')); };
    try {
      Site.initAll();
      demos.forEach(d => (d.spec.controls || []).forEach(c => {
        if (c.act) { d.btn(c.act).click(); Object.keys(d._run).forEach(k => { d._run[k] = false; }); d.draw(); return; }
        const type = c.type || 'range';
        if (type === 'checks') { c.options.forEach(o => { d.state[c.k][o[0]] = !d.state[c.k][o[0]]; d.draw(c.k); d.state[c.k][o[0]] = !d.state[c.k][o[0]]; }); d.draw(c.k); return; }
        const orig = d.state[c.k];
        (type === 'range' ? [c.min, c.max] : type === 'check' ? [true, false] : c.options.map(o => o[0])).forEach(v => { d.set(c.k, v); d.draw(c.k); });
        d.set(c.k, orig); d.draw(c.k);
      }));
    } finally { console.error = oe; }
    const de = document.documentElement;
    return {
      demos: demos.map(d => d.id + ':' + $$('canvas', d.root).length + '/' + $$('.chart', d.root).length).join(' '),
      emptyCharts: demos.filter(d => $$('canvas', d.root).length < $$('.chart', d.root).length).map(d => d.id),
      errors: errs, badTags: $$('.tag.bad').filter(e => /出错了/.test(e.textContent)).map(e => e.textContent),
      mathErrors: $$('.katex-error').map(e => e.textContent.slice(0, 60)),
      overflowX: de.scrollWidth - de.clientWidth,
    };
  };

  /* ---------- 小组件：指标卡 / 表格 / 测验 / 流程 ---------- */
  // tiles([[标签, 值, 备注?, 'good'|'bad'?], ...])
  Site.tiles = list => '<div class="tiles">' + list.map(t => `<div class="tile ${t[3] || ''}"><div class="k">${t[0]}</div><div class="v">${typeof t[1] === 'number' ? Site.fmt(t[1]) : t[1]}</div>${t[2] ? `<div class="n">${t[2]}</div>` : ''}</div>`).join('') + '</div>';
  // table(['列1','列2'], [[..],[..]], {num:[1,2], hl:行号})
  Site.table = function (head, rows, o) {
    o = o || {}; const num = o.num || [];
    const cls = i => num.includes(i) ? ' class="num"' : '';
    return '<div class="tw"><table><thead><tr>' + head.map((h, i) => `<th${cls(i)}>${h}</th>`).join('') + '</tr></thead><tbody>' +
      rows.map((r, ri) => `<tr${o.hl === ri ? ' class="hl"' : ''}>` + r.map((c, i) => `<td${cls(i)}>${typeof c === 'number' ? Site.fmt(c) : c}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>';
  };
  // quiz('容器id', [{q, opts:[...], ans:下标, why}])
  Site.quiz = function (id, qs) {
    const root = document.getElementById(id); if (!root) return;
    root.classList.add('quiz');
    root.innerHTML = qs.map((q, i) => `<div class="q"><p>${i + 1}. ${q.q}</p>` + q.opts.map((o, j) => `<button class="opt" data-j="${j}">${'ABCD'[j]}. ${o}</button>`).join('') + `<div class="why">${q.why}</div></div>`).join('');
    $$('.q', root).forEach((el, i) => $$('.opt', el).forEach(b => {
      b.onclick = () => {
        $$('.opt', el).forEach(x => x.classList.remove('ok', 'no'));
        const j = +b.dataset.j;
        if (j === qs[i].ans) b.classList.add('ok'); else { b.classList.add('no'); $$('.opt', el)[qs[i].ans].classList.add('ok'); }
        el.classList.add('answered');
      };
    }));
    Site.math(root);
  };
  // flow('容器id', [{t:'步骤名', d:'说明 html'}])  可点击的流程图
  Site.flow = function (id, steps, start) {
    const root = document.getElementById(id); if (!root) return;
    root.innerHTML = '<div class="flow">' + steps.map((s, i) => `<button type="button" data-i="${i}">${s.t}</button>`).join('') + '</div><div class="flow-detail"></div>';
    const det = $('.flow-detail', root), bs = $$('button', root);
    const pick = i => { bs.forEach((b, j) => b.classList.toggle('on', i === j)); det.innerHTML = steps[i].d; Site.math(det); };
    bs.forEach((b, i) => { b.onclick = () => pick(i); });
    pick(start || 0);
  };

  /* ---------- 首页：学习路线 ---------- */
  Site.roadmap = function (id) {
    const root = document.getElementById(id); if (!root) return;
    const done = getDone();
    const n = CHAPTERS.filter(c => done.includes(c.id)).length;
    let h = `<div class="small muted">学习进度：已完成 ${n} / ${CHAPTERS.length} 章（进度保存在本机浏览器）</div><div class="progress"><i style="width:${n / CHAPTERS.length * 100}%"></i></div>`;
    const parts = [];
    CHAPTERS.forEach(c => { let p = parts.find(x => x.name === c.part); if (!p) { p = { name: c.part, list: [] }; parts.push(p); } p.list.push(c); });
    const note = { '基础篇': '先学会看数据、治数据、评估预测', '统计模型': '可解释、数据少也能用的经典方法', '机器学习': '把预测变成表格问题，用特征取胜', '深度学习': '只讲现在最常用的：LSTM 与 Transformer', '业务实战': '把模型放回业务里比一比' };
    parts.forEach(p => {
      h += `<div class="part-title">${p.name}<small>${note[p.name] || ''}</small></div><div class="ch-grid">` +
        p.list.map(c => `<a class="ch-card${done.includes(c.id) ? ' done' : ''}" href="chapters/${c.file}"><div class="top"><span>第 ${c.id} 章 · ${c.min} 分钟</span><span>${done.includes(c.id) ? '✓ 已学完' : ''}</span></div><h3>${esc(c.title)}</h3><p>${esc(c.desc)}</p></a>`).join('') + '</div>';
    });
    root.innerHTML = h;
  };

  /* ---------- 启动 ---------- */
  buildChrome();
  enhanceCode();
  // 结构图在手机上保持可读的字号：包一层可横向滑动的容器
  $$('svg.diagram').forEach(svg => { const w = document.createElement('div'); w.className = 'svg-scroll'; svg.parentNode.insertBefore(w, svg); w.appendChild(svg); });
  Site.math($('main'));
  g.Site = Site;
})(window);
