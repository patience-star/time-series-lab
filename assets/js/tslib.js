/* 时间序列实验室 · 时序算法库（全局对象 TS）
 * 全部手写、无依赖，浏览器与 Node 通用（tests/selfcheck.mjs 会校验这里的每个算法）。
 * 目录：随机数 → 统计 → 日期 → 仿真数据 → 自相关/差分/分解 → 线性代数/检验 → 基线
 *       → 指数平滑 → 优化器 → ARIMA → 评估与回测 → 脏数据注入与清洗
 */
(function (g) {
  'use strict';
  const TS = {};

  /* ================= 随机数（固定种子，可复现） ================= */
  TS.rng = function (seed) {
    let a = seed >>> 0;
    const r = function () { // mulberry32
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    r.n = function () { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
    r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
    return r;
  };

  /* ================= 基础统计 ================= */
  const sum = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  const mean = a => a.length ? sum(a) / a.length : NaN;
  const variance = (a, ddof) => { const m = mean(a); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return s / (a.length - (ddof || 0)); };
  const std = (a, ddof) => Math.sqrt(variance(a, ddof));
  const quantile = (a, q) => {
    const b = a.filter(Number.isFinite).sort((x, y) => x - y);
    if (!b.length) return NaN;
    const p = (b.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
    return b[lo] + (b[hi] - b[lo]) * (p - lo);
  };
  const median = a => quantile(a, 0.5);
  Object.assign(TS, { sum, mean, variance, std, quantile, median });
  TS.nanmean = a => mean(a.filter(Number.isFinite));
  TS.corr = (a, b) => { const ma = mean(a), mb = mean(b); let sab = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return sab / Math.sqrt(sa * sb); };
  TS.cumsum = a => { let s = 0; return a.map(v => (s += v)); };

  /* ================= 日期工具（一律按 UTC 处理，避开夏令时） ================= */
  TS.dates = function (start, n, unit) {
    const [Y, M, D] = start.split('-').map(Number), out = [];
    for (let i = 0; i < n; i++) {
      if (unit === 'month') out.push(new Date(Date.UTC(Y, M - 1 + i, 1)).toISOString().slice(0, 7));
      else if (unit === 'hour') out.push(new Date(Date.UTC(Y, M - 1, D, i)).toISOString().slice(0, 13).replace('T', ' ') + ':00');
      else out.push(new Date(Date.UTC(Y, M - 1, D + i)).toISOString().slice(0, 10));
    }
    return out;
  };
  TS.dayIndex = s => Math.round(Date.parse(s.slice(0, 10) + 'T00:00:00Z') / 864e5);
  TS.dayStr = k => new Date(k * 864e5).toISOString().slice(0, 10);
  TS.dow = s => new Date(s.slice(0, 10) + 'T00:00:00Z').getUTCDay(); // 0=周日 … 6=周六
  TS.DOW = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // 日 → 周/月 聚合（求和）。n 为每个桶里的天数，用来识别首尾"不完整周期"
  TS.resample = function (dates, y, unit) {
    const m = new Map();
    dates.forEach((d, i) => {
      const k = unit === 'month' ? d.slice(0, 7) : TS.dayStr(TS.dayIndex(d) - ((TS.dow(d) + 6) % 7));
      if (!m.has(k)) m.set(k, [0, 0]);
      const o = m.get(k); o[0] += y[i]; o[1]++;
    });
    const ks = [...m.keys()];
    return { dates: ks, y: ks.map(k => m.get(k)[0]), n: ks.map(k => m.get(k)[1]) };
  };

  /* ================= 仿真业务数据（固定种子；返回对象请勿原地修改） ================= */
  const cache = {};
  const memo = (k, f) => () => cache[k] || (cache[k] = f());
  TS.data = {};

  // 电商日销量：增长趋势 × 周内季节 × 年度起伏 × 大促/春节事件 × 噪声
  TS.data.retail = memo('retail', function () {
    const r = TS.rng(20240618), n = 1096, dates = TS.dates('2022-01-01', n);
    const dowMul = [1.14, 0.93, 0.90, 0.92, 0.96, 1.03, 1.18];
    const cny = ['2022-02-01', '2023-01-22', '2024-02-10'].map(TS.dayIndex);
    const small = new Array(n).fill(0);
    for (let t = 20; t < n; t += 21 + r.int(0, 21)) for (let k = 0; k < 3 && t + k < n; k++) small[t + k] = 1;
    const y = [], promo = [], holiday = [], event = [], price = [];
    for (let i = 0; i < n; i++) {
      const d = dates[i], mo = +d.slice(5, 7), dd = +d.slice(8), di = TS.dayIndex(d);
      const trend = 1000 * (1 + 0.55 * i / n);
      const yr = 1 + 0.08 * Math.sin(2 * Math.PI * (i - 60) / 365.25);
      let ev = 1, tag = null, pr = 0, hol = 0;
      if (mo === 6 && dd <= 17) { ev *= 1.12; tag = '618预热'; pr = 1; }
      if (mo === 6 && dd === 18) { ev *= 2.3; tag = '618'; pr = 1; }
      if (mo === 6 && dd >= 19 && dd <= 21) ev *= 0.85;
      if (mo === 11 && dd <= 10) { ev *= 1.15; tag = '双11预热'; pr = 1; }
      if (mo === 11 && dd === 11) { ev *= 3.0; tag = '双11'; pr = 1; }
      if (mo === 11 && dd >= 12 && dd <= 15) ev *= 0.8;
      for (const c of cny) {
        const k = di - c;
        if (k >= -3 && k <= 6) { ev *= 0.45 + 0.04 * Math.abs(k - 1); hol = 1; tag = '春节'; }
        else if (k >= -20 && k < -3) { ev *= 1.18; tag = tag || '年货节'; }
      }
      if (small[i] && !tag) { ev *= 1.35; pr = 1; tag = '小促'; }
      const v = trend * yr * dowMul[TS.dow(d)] * ev * Math.exp(0.05 * r.n());
      y.push(Math.round(v)); promo.push(pr); holiday.push(hol); event.push(tag); price.push(pr ? 79 : 99);
    }
    return { key: 'retail', name: '电商日销量', unit: '件', dates, y, promo, holiday, event, price, period: 7 };
  });

  // 电力小时负荷：日内双峰 × 周末折扣 + 气温驱动的空调负荷
  TS.data.load = memo('load', function () {
    const r = TS.rng(77), n = 24 * 56, dates = TS.dates('2024-06-03', n, 'hour'); // 2024-06-03 是周一
    const prof = [0.62, 0.58, 0.56, 0.55, 0.56, 0.6, 0.7, 0.82, 0.92, 0.98, 1.0, 0.99, 0.94, 0.95, 0.97, 0.98, 0.99, 1.02, 1.08, 1.12, 1.1, 1.0, 0.86, 0.72];
    const y = [], temp = []; let wx = 0;
    for (let i = 0; i < n; i++) {
      const h = i % 24, day = Math.floor(i / 24), dw = (day + 1) % 7;
      if (h === 0) wx = 0.8 * wx + 1.6 * r.n();
      const tp = 27.5 + 2 * Math.sin(2 * Math.PI * day / 28) + wx + 4.5 * Math.sin(2 * Math.PI * (h - 9) / 24) + 0.4 * r.n(); // 热浪起伏 + 天气随机波动 + 日内变化
      const wk = (dw === 0 || dw === 6) ? 0.86 : 1;
      const v = (3200 * prof[h] * wk + 70 * Math.max(0, tp - 26)) * (1 + 0.015 * r.n());
      y.push(Math.round(v)); temp.push(+tp.toFixed(1));
    }
    return { key: 'load', name: '电力小时负荷', unit: 'MW', dates, y, temp, period: 24 };
  });

  // App 日活：S 型增长 × 周内季节 + 版本发布带来的台阶 + 几个事故/活动异常
  TS.data.dau = memo('dau', function () {
    const r = TS.rng(31415), n = 540, dates = TS.dates('2023-07-01', n);
    const dowMul = [1.10, 0.97, 0.96, 0.96, 0.97, 1.0, 1.08];
    const release = [150, 330], shock = { 210: -0.42, 211: -0.2, 395: 0.34, 470: -0.3 };
    const y = [], anomalies = [];
    for (let i = 0; i < n; i++) {
      let lvl = 52000 + 38000 / (1 + Math.exp(-(i - 240) / 90));
      if (i >= release[0]) lvl *= 1.05;
      if (i >= release[1]) lvl *= 1.06;
      let v = lvl * dowMul[TS.dow(dates[i])] * (1 + 0.02 * r.n());
      if (shock[i] != null) { v *= 1 + shock[i]; anomalies.push(i); }
      y.push(Math.round(v));
    }
    return { key: 'dau', name: 'App 日活 (DAU)', unit: '人', dates, y, anomalies, release, period: 7 };
  });

  // 月度销售额：带漂移的随机游走（随机趋势）× 乘法季节（幅度随水平放大）
  TS.data.monthly = memo('monthly', function () {
    const r = TS.rng(1949), n = 120, dates = TS.dates('2015-01-01', n, 'month');
    const sea = [0.86, 0.82, 0.95, 0.97, 1.0, 1.1, 1.22, 1.2, 1.05, 0.96, 0.88, 0.99];
    const y = []; let lv = Math.log(120);
    for (let i = 0; i < n; i++) { lv += 0.011 + 0.025 * r.n(); y.push(Math.round(Math.exp(lv) * sea[i % 12] * Math.exp(0.02 * r.n()))); }
    return { key: 'monthly', name: '月度销售额', unit: '万元', dates, y, period: 12 };
  });

  // 股价：对数随机游走（故意放进来当"预测不了"的反例）
  TS.data.stock = memo('stock', function () {
    const r = TS.rng(888), n = 500, dates = TS.dates('2023-01-02', n), y = [];
    let p = Math.log(50);
    for (let i = 0; i < n; i++) { p += 0.0004 + 0.018 * r.n(); y.push(+Math.exp(p).toFixed(2)); }
    return { key: 'stock', name: '股价（随机游走）', unit: '元', dates, y, period: 5 };
  });

  // ARMA 模拟：x_t = Σ ar_i x_{t-i} + e_t + Σ ma_j e_{t-j}
  TS.simArma = function (n, ar, ma, rng, sigma) {
    ar = ar || []; ma = ma || []; sigma = sigma == null ? 1 : sigma;
    const burn = 200, x = [], e = [];
    for (let t = 0; t < n + burn; t++) {
      e.push(sigma * rng.n());
      let v = e[t];
      for (let i = 0; i < ar.length; i++) if (t - 1 - i >= 0) v += ar[i] * x[t - 1 - i];
      for (let j = 0; j < ma.length; j++) if (t - 1 - j >= 0) v += ma[j] * e[t - 1 - j];
      x.push(v);
    }
    return x.slice(burn);
  };

  /* ================= 自相关 / 差分 / 平滑 / 分解 ================= */
  TS.acf = function (x, maxLag) {
    const n = x.length, m = mean(x), out = [1];
    let c0 = 0; for (let i = 0; i < n; i++) c0 += (x[i] - m) ** 2;
    for (let k = 1; k <= maxLag; k++) {
      let c = 0; for (let i = k; i < n; i++) c += (x[i] - m) * (x[i - k] - m);
      out.push(c0 > 0 ? c / c0 : 0);
    }
    return out;
  };
  // 偏自相关：Durbin–Levinson 递推
  TS.pacf = function (x, maxLag) {
    const r = TS.acf(x, maxLag), out = [1];
    let phi = [];
    for (let k = 1; k <= maxLag; k++) {
      let num = r[k], den = 1;
      for (let j = 1; j < k; j++) { num -= phi[j - 1] * r[k - j]; den -= phi[j - 1] * r[j]; }
      const pk = den !== 0 ? num / den : 0, nphi = [];
      for (let j = 1; j < k; j++) nphi.push(phi[j - 1] - pk * phi[k - 1 - j]);
      nphi.push(pk); phi = nphi; out.push(pk);
    }
    return out;
  };
  TS.diff = (x, lag) => { lag = lag || 1; const out = []; for (let i = lag; i < x.length; i++) out.push(x[i] - x[i - lag]); return out; };

  // 移动平均。centered=true 时居中（偶数窗口用 2×w 加权），边缘为 NaN；false 为只看过去的滚动均值
  TS.ma = function (x, w, centered) {
    const n = x.length, out = new Array(n).fill(NaN);
    if (centered === false || w % 2 === 1) {
      const h = centered === false ? 0 : (w - 1) / 2;
      let s = 0;
      for (let i = 0; i < n; i++) { s += x[i]; if (i >= w) s -= x[i - w]; if (i >= w - 1) out[i - h] = s / w; }
    } else {
      const h = w / 2;
      for (let i = h; i < n - h; i++) { let s = 0.5 * x[i - h] + 0.5 * x[i + h]; for (let j = i - h + 1; j < i + h; j++) s += x[j]; out[i] = s / w; }
    }
    return out;
  };

  // 经典分解：趋势 = 居中移动平均；季节 = 去趋势后按相位取平均；残差 = 剩下的
  TS.decompose = function (x, m, type) {
    const n = x.length, mul = type === 'mul', trend = TS.ma(x, m, true);
    const det = x.map((v, i) => Number.isNaN(trend[i]) ? NaN : (mul ? v / trend[i] : v - trend[i]));
    const idx = [];
    for (let k = 0; k < m; k++) { const vals = []; for (let i = k; i < n; i += m) if (!Number.isNaN(det[i])) vals.push(det[i]); idx.push(mean(vals)); }
    const adj = mean(idx), index = idx.map(v => mul ? v / adj : v - adj);
    const seasonal = x.map((_, i) => index[i % m]);
    const resid = x.map((v, i) => Number.isNaN(trend[i]) ? NaN : (mul ? v / trend[i] / seasonal[i] : v - trend[i] - seasonal[i]));
    return { trend, seasonal, resid, index };
  };

  /* ================= 线性代数 / 回归 / 分布 / 检验 ================= */
  TS.inv = function (A) { // Gauss–Jordan 求逆（带主元）
    const n = A.length, M = A.map((r, i) => r.concat(Array.from({ length: n }, (_, j) => +(i === j))));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) M[p][c] = 1e-12;
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c]; for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f !== 0) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
    }
    return M.map(r => r.slice(n));
  };
  // 最小二乘（可带岭惩罚）。X 为行数组；返回系数、标准误、残差
  TS.ols = function (X, y, ridge) {
    const n = X.length, p = X[0].length, A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
    for (let i = 0; i < n; i++) { const r = X[i]; for (let a = 0; a < p; a++) { b[a] += r[a] * y[i]; for (let c = a; c < p; c++) A[a][c] += r[a] * r[c]; } }
    for (let a = 0; a < p; a++) { for (let c = 0; c < a; c++) A[a][c] = A[c][a]; A[a][a] += ridge || 0; }
    const inv = TS.inv(A), beta = inv.map(row => row.reduce((s, v, j) => s + v * b[j], 0));
    const resid = []; let sse = 0;
    for (let i = 0; i < n; i++) { let f = 0; for (let a = 0; a < p; a++) f += X[i][a] * beta[a]; resid.push(y[i] - f); sse += (y[i] - f) ** 2; }
    const sigma2 = sse / Math.max(1, n - p);
    return { beta, se: inv.map((row, j) => Math.sqrt(Math.max(0, row[j] * sigma2))), resid, sse, sigma2 };
  };

  function lgamma(z) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = z, t = z + 5.5; t -= (z + 0.5) * Math.log(t);
    let s = 1.000000000190015; for (let j = 0; j < 6; j++) s += c[j] / ++y;
    return -t + Math.log(2.5066282746310005 * s / z);
  }
  function gammq(a, x) { // 上不完全伽马函数（正则化）
    if (x <= 0) return 1;
    const lead = Math.exp(-x + a * Math.log(x) - lgamma(a));
    if (x < a + 1) { let ap = a, s = 1 / a, d = s; for (let n = 0; n < 300; n++) { ap++; d *= x / ap; s += d; if (Math.abs(d) < Math.abs(s) * 1e-13) break; } return 1 - s * lead; }
    let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
    for (let i = 1; i < 300; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-13) break; }
    return lead * h;
  }
  TS.chi2sf = (x, k) => gammq(k / 2, x / 2);       // 卡方分布右尾概率
  TS.normCdf = function (x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2), z = Math.abs(x) / Math.SQRT2;
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
  };
  TS.normInv = function (p) { // 标准正态分位数（Acklam 近似）
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const tail = q => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
    if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  };

  // ADF 单位根检验（带常数项）：Δx_t = α + γ·x_{t-1} + Σ δ_i Δx_{t-i} + ε，统计量 = γ / se(γ)
  TS.adf = function (x, lags) {
    const n = x.length;
    if (lags == null) lags = Math.min(12, Math.floor(Math.cbrt(n)));
    const dx = TS.diff(x), X = [], Y = [];
    for (let t = lags; t < dx.length; t++) { const row = [1, x[t]]; for (let j = 1; j <= lags; j++) row.push(dx[t - j]); X.push(row); Y.push(dx[t]); }
    const f = TS.ols(X, Y), stat = f.beta[1] / f.se[1];
    return { stat, lags, crit: { '1%': -3.43, '5%': -2.86, '10%': -2.57 }, stationary: stat < -2.86 };
  };
  // Ljung–Box：残差前 h 阶自相关是否整体为 0（p 大 = 像白噪声 = 模型把规律榨干了）
  TS.ljungBox = function (resid, h, fitdf) {
    const n = resid.length, r = TS.acf(resid, h);
    let Q = 0; for (let k = 1; k <= h; k++) Q += r[k] * r[k] / (n - k);
    Q *= n * (n + 2);
    const df = Math.max(1, h - (fitdf || 0));
    return { Q, df, p: TS.chi2sf(Q, df) };
  };

  /* ================= 基线预测 ================= */
  TS.fc = {
    mean: (y, h) => new Array(h).fill(mean(y)),
    naive: (y, h) => new Array(h).fill(y[y.length - 1]),
    snaive: (y, h, m) => Array.from({ length: h }, (_, i) => y[y.length - m + (i % m)]),
    drift: (y, h) => { const n = y.length, s = (y[n - 1] - y[0]) / (n - 1); return Array.from({ length: h }, (_, i) => y[n - 1] + s * (i + 1)); },
  };

  /* ================= 指数平滑（SES / Holt / Holt-Winters 统一实现） =================
   * o = {alpha, beta, gamma, phi, trend:bool, seasonal:null|'add'|'mul', m}
   * 水平 l、趋势 t、季节 s 三个状态逐点更新；fitted 为"一步向前"预测 */
  TS.ets = function (y, o) {
    const n = y.length, m = o.m || 1, hasT = !!o.trend, sea = o.seasonal || null, mul = sea === 'mul';
    const a = o.alpha, b = o.beta || 0, gm = o.gamma || 0, phi = o.phi == null ? 1 : o.phi;
    let l, t = 0; const s = [];
    if (sea) {
      l = mean(y.slice(0, m));
      if (hasT) t = n >= 2 * m ? (mean(y.slice(m, 2 * m)) - l) / m : 0;
      for (let i = 0; i < m; i++) s.push(mul ? y[i] / l : y[i] - l);
    } else { l = y[0]; if (hasT) t = n > 1 ? y[1] - y[0] : 0; }
    const fitted = new Array(n), level = new Array(n), trend = new Array(n), season = new Array(n);
    let sse = 0;
    for (let i = 0; i < n; i++) {
      const si = sea ? s[i % m] : 0, base = l + phi * t;
      const f = mul ? base * si : base + si;
      fitted[i] = f; sse += (y[i] - f) ** 2;
      const lPrev = l;
      l = a * (mul ? y[i] / si : y[i] - si) + (1 - a) * base;
      if (hasT) t = b * (l - lPrev) + (1 - b) * phi * t;
      if (sea) s[i % m] = gm * (mul ? y[i] / l : y[i] - l) + (1 - gm) * si;
      level[i] = l; trend[i] = t; season[i] = sea ? s[i % m] : 0;
    }
    const sigma = Math.sqrt(sse / n);
    const forecast = function (h, lvl) {
      const mu = [], se = []; let ph = 0;
      const bb = a * b, gg = gm * (1 - a);
      for (let k = 1; k <= h; k++) {
        ph += Math.pow(phi, k);
        const base = l + (hasT ? ph * t : 0), si = sea ? s[(n + k - 1) % m] : 0;
        mu.push(mul ? base * si : base + si);
        let v = 1 + (hasT ? (k - 1) * (a * a + a * bb * k + bb * bb * k * (2 * k - 1) / 6) : a * a * (k - 1));
        if (sea) v += gg * Math.floor((k - 1) / m) * (2 * a + gg);
        se.push(sigma * Math.sqrt(v)); // 加法误差公式；乘法季节下为近似
      }
      const z = TS.normInv(0.5 + (lvl || 0.95) / 2);
      return { mean: mu, se, lo: mu.map((v, i) => v - z * se[i]), hi: mu.map((v, i) => v + z * se[i]) };
    };
    return { fitted, level, trend, season, sse, sigma, forecast, params: { alpha: a, beta: b, gamma: gm, phi } };
  };
  // 自动寻优：最小化一步预测误差平方和。返回拟合结果，并带上寻优轨迹 path（用于动画）
  TS.etsFit = function (y, o) {
    const keys = ['alpha']; if (o.trend) keys.push('beta'); if (o.seasonal) keys.push('gamma');
    const sig = v => 1 / (1 + Math.exp(-v));
    const f = u => { const p = Object.assign({}, o); keys.forEach((k, i) => { p[k] = sig(u[i]); }); const v = TS.ets(y, p).sse; return Number.isFinite(v) ? v : 1e300; };
    const r = TS.nelderMead(f, keys.map(k => k === 'alpha' ? 0 : -2), { maxIter: 250, step: 1 });
    const p = Object.assign({}, o); keys.forEach((k, i) => { p[k] = +sig(r.x[i]).toFixed(4); });
    const fit = TS.ets(y, p);
    fit.keys = keys; fit.path = r.path.map(u => u.map(sig)); fit.iters = r.iters;
    return fit;
  };

  /* ================= Nelder–Mead 单纯形优化（无需梯度） ================= */
  TS.nelderMead = function (f, x0, o) {
    o = o || {};
    const n = x0.length, maxIter = o.maxIter || 400, tol = o.tol || 1e-9, step = o.step || 0.5;
    if (!n) return { x: [], fx: f([]), iters: 0, path: [] };
    let sim = [x0.slice()];
    for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step; sim.push(x); }
    let fs = sim.map(f), it = 0; const path = [];
    for (; it < maxIter; it++) {
      const ord = fs.map((_, i) => i).sort((p, q) => fs[p] - fs[q]);
      sim = ord.map(i => sim[i]); fs = ord.map(i => fs[i]);
      path.push(sim[0].slice());
      if (Math.abs(fs[n] - fs[0]) <= tol * (Math.abs(fs[0]) + tol)) break;
      const c = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += sim[i][j] / n;
      const pt = k => c.map((v, j) => v + k * (sim[n][j] - v));
      const xr = pt(-1), fr = f(xr);
      if (fr < fs[0]) { const xe = pt(-2), fe = f(xe); if (fe < fr) { sim[n] = xe; fs[n] = fe; } else { sim[n] = xr; fs[n] = fr; } }
      else if (fr < fs[n - 1]) { sim[n] = xr; fs[n] = fr; }
      else {
        const xc = fr < fs[n] ? pt(-0.5) : pt(0.5), fc = f(xc);
        if (fc < Math.min(fr, fs[n])) { sim[n] = xc; fs[n] = fc; }
        else for (let i = 1; i <= n; i++) { sim[i] = sim[i].map((v, j) => sim[0][j] + 0.5 * (v - sim[0][j])); fs[i] = f(sim[i]); }
      }
    }
    let b = 0; for (let i = 1; i <= n; i++) if (fs[i] < fs[b]) b = i;
    return { x: sim[b], fx: fs[b], iters: it, path };
  };

  /* ================= ARIMA / SARIMA =================
   * ponytail: 用"条件平方和"(CSS) 估计而非精确极大似然——实现短、够教学用；
   *           小样本或接近单位根时系数会和 statsmodels 略有出入。要升级就换成卡尔曼滤波似然。
   * 模型：φ(B)Φ(B^s)(1-B)^d(1-B^s)^D y_t = c + θ(B)Θ(B^s) e_t
   * 约定：AR 系数取正号进入右边（y_t = φ1·y_{t-1} + …），MA 系数取正号（… + θ1·e_{t-1}） */
  function polyMul(a, b) { const out = new Array(a.length + b.length - 1).fill(0); for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j]; return out; }
  // 把 (-1,1) 内的偏自相关映射成一组平稳的 AR 系数，保证优化过程不会跑到非平稳区
  function pacf2ar(r) { let a = []; for (let k = 0; k < r.length; k++) { const b = a.slice(); a[k] = r[k]; for (let i = 0; i < k; i++) a[i] = b[i] - r[k] * b[k - 1 - i]; } return a; }
  function lagPoly(coefs, s, sign) { const out = new Array(coefs.length * s + 1).fill(0); out[0] = 1; coefs.forEach((c, i) => { out[(i + 1) * s] = sign * c; }); return out; }

  TS.arima = function (y, o) {
    o = o || {};
    const p = o.p | 0, d = o.d | 0, q = o.q | 0, P = o.P | 0, D = o.D | 0, Q = o.Q | 0, s = (P || D || Q) ? (o.s || 1) : 1;
    let w = y.slice();
    for (let i = 0; i < d; i++) w = TS.diff(w, 1);
    for (let i = 0; i < D; i++) w = TS.diff(w, s);
    const useMean = d + D === 0 && o.mean !== false, mu = useMean ? mean(w) : 0;
    const z = w.map(v => v - mu), n = z.length, k = p + q + P + Q;
    if (n - (p + s * P) < k + 8) throw new Error('数据太短，撑不起这个阶数');

    const unpack = u => {
      const t = u.map(Math.tanh);
      return { ar: pacf2ar(t.slice(0, p)), ma: pacf2ar(t.slice(p, p + q)).map(v => -v), sar: pacf2ar(t.slice(p + q, p + q + P)), sma: pacf2ar(t.slice(p + q + P)).map(v => -v) };
    };
    const expand = c => {
      const A = polyMul(lagPoly(c.ar, 1, -1), lagPoly(c.sar, s, -1)), B = polyMul(lagPoly(c.ma, 1, 1), lagPoly(c.sma, s, 1));
      return { a: A.slice(1).map(v => -v), b: B.slice(1) };
    };
    const css = (a, b, keep) => { // 递推出残差 e_t，返回平方和
      const na = a.length, nb = b.length, e = new Float64Array(n); let ss = 0;
      for (let t = na; t < n; t++) {
        let v = z[t];
        for (let i = 0; i < na; i++) v -= a[i] * z[t - 1 - i];
        const jm = Math.min(nb, t); for (let j = 0; j < jm; j++) v -= b[j] * e[t - 1 - j];
        e[t] = v; ss += v * v;
      }
      return keep ? { ss, e } : ss;
    };
    const obj = u => { const c = expand(unpack(u)), v = css(c.a, c.b); return Number.isFinite(v) ? v : 1e300; };
    const opt = TS.nelderMead(obj, new Array(k).fill(0.1), { maxIter: o.maxIter || 150 * k + 150, step: 0.3 });
    const coef = unpack(opt.x), ex = expand(coef), a = ex.a, b = ex.b, fin = css(a, b, true), e = fin.e;
    const na = a.length, nobs = n - na, sigma2 = fin.ss / nobs;
    const loglik = -nobs / 2 * (Math.log(2 * Math.PI * sigma2) + 1), npar = k + (useMean ? 1 : 0) + 1;
    const aic = -2 * loglik + 2 * npar, bic = -2 * loglik + npar * Math.log(nobs);

    // 回到原始尺度：把差分算子乘进 AR 多项式，y_t = c + Σ A_i·y_{t-i} + e_t + Σ b_j·e_{t-j}
    let full = [1].concat(a.map(v => -v));
    for (let i = 0; i < d; i++) full = polyMul(full, [1, -1]);
    for (let i = 0; i < D; i++) { const sp = new Array(s + 1).fill(0); sp[0] = 1; sp[s] = -1; full = polyMul(full, sp); }
    const A = full.slice(1).map(v => -v), c = mu * (1 - sum(a)), off = y.length - n, N = y.length;
    const eY = new Array(N).fill(0);
    for (let t = na; t < n; t++) eY[t + off] = e[t];
    const fitted = y.map((v, t) => t >= off + na ? v - eY[t] : NaN);

    const forecast = function (h, lvl) {
      const hist = y.slice(), m = [];
      for (let i = 0; i < h; i++) {
        let v = c;
        for (let j = 0; j < A.length; j++) { const ix = N + i - 1 - j; if (ix >= 0) v += A[j] * hist[ix]; }
        for (let j = 0; j < b.length; j++) { const ix = N + i - 1 - j; if (ix >= 0 && ix < N) v += b[j] * eY[ix]; }
        hist.push(v); m.push(v);
      }
      // ψ 权重：h 步预测误差 = Σ_{j<h} ψ_j·e，方差 = σ²·Σψ_j²  → 区间随步长变宽
      const psi = [1], se = []; let acc = 0;
      for (let j = 1; j < h; j++) { let v = j - 1 < b.length ? b[j - 1] : 0; for (let i = 1; i <= Math.min(j, A.length); i++) v += A[i - 1] * psi[j - i]; psi.push(v); }
      for (let j = 0; j < h; j++) { acc += psi[j] * psi[j]; se.push(Math.sqrt(sigma2 * acc)); }
      const zq = TS.normInv(0.5 + (lvl || 0.95) / 2);
      return { mean: m, se, lo: m.map((v, i) => v - zq * se[i]), hi: m.map((v, i) => v + zq * se[i]) };
    };
    return { order: { p, d, q, P, D, Q, s }, coef, mu: useMean ? mu : null, sigma2, aic, bic, loglik, resid: Array.from(e).slice(na), fitted, forecast, nobs, iters: opt.iters };
  };

  /* ================= 评估指标与滚动回测 ================= */
  // 返回 {mae, rmse, mape, smape, wape, bias, mase?}；比例类指标是小数（0.1 = 10%）
  TS.metrics = function (actual, pred, o) {
    o = o || {};
    let n = 0, ae = 0, se = 0, ape = 0, nApe = 0, sm = 0, sa = 0, bias = 0;
    for (let i = 0; i < actual.length; i++) {
      const a = actual[i], f = pred[i];
      if (!Number.isFinite(a) || !Number.isFinite(f)) continue;
      const e = f - a; n++; ae += Math.abs(e); se += e * e; bias += e; sa += Math.abs(a);
      if (a !== 0) { ape += Math.abs(e / a); nApe++; }
      const den = Math.abs(a) + Math.abs(f); if (den > 0) sm += 2 * Math.abs(e) / den;
    }
    const out = { n, mae: ae / n, rmse: Math.sqrt(se / n), mape: nApe ? ape / nApe : NaN, smape: sm / n, wape: sa > 0 ? ae / sa : NaN, bias: bias / n };
    if (o.train) { // MASE：用训练集上"季节朴素"的平均误差做尺子，<1 说明比朴素强
      const m = o.m || 1, tr = o.train; let dsum = 0, c = 0;
      for (let i = m; i < tr.length; i++) if (Number.isFinite(tr[i]) && Number.isFinite(tr[i - m])) { dsum += Math.abs(tr[i] - tr[i - m]); c++; }
      out.mase = c && dsum > 0 ? out.mae / (dsum / c) : NaN;
    }
    return out;
  };
  // 分位数损失（pinball）：tau=0.9 时，低估的惩罚是高估的 9 倍
  TS.pinball = (actual, qpred, tau) => mean(actual.map((a, i) => { const u = a - qpred[i]; return u >= 0 ? tau * u : (tau - 1) * u; }));

  // 滚动起点回测：model(train, h, cut) → 预测数组。o = {h, folds, step, m, window, minTrain}
  TS.backtest = function (y, model, o) {
    o = o || {};
    const h = o.h || 7, folds = o.folds || 5, step = o.step || h, n = y.length, m = o.m || 1, res = [];
    for (let k = folds - 1; k >= 0; k--) {
      const cut = n - h - k * step;
      if (cut < (o.minTrain || 2 * m + 10)) continue;
      const train = o.window ? y.slice(Math.max(0, cut - o.window), cut) : y.slice(0, cut), actual = y.slice(cut, cut + h);
      const t0 = Date.now(), pred = model(train, h, cut);
      res.push({ cut, pred, actual, ms: Date.now() - t0, metrics: TS.metrics(actual, pred, { train, m }) });
    }
    const avg = {};
    ['mae', 'rmse', 'mape', 'smape', 'wape', 'mase', 'bias'].forEach(k => { avg[k] = mean(res.map(r => r.metrics[k]).filter(Number.isFinite)); });
    const byH = [];
    for (let i = 0; i < h; i++) byH.push(mean(res.map(r => Math.abs(r.pred[i] - r.actual[i])).filter(Number.isFinite)));
    return { folds: res, avg, byH, ms: sum(res.map(r => r.ms)) };
  };

  /* ================= 脏数据：注入（教学用）与清洗 ================= */
  // 在干净数据上按 kinds 注入各类问题。因为保留了真值 truth，清洗效果可以打分。
  // kinds: {stockout, shift, spike, neg, flat, tail, miss, block, gap, dup}
  // opts.recent = N：只在最近 N 天里注入（让脏数据集中在模型最依赖的近期）
  TS.dirty = function (ds, kinds, seed, opts) {
    opts = opts || {};
    const r = TS.rng(seed || 7), n = ds.y.length, y = ds.y.slice(), used = new Set();
    const lo0 = opts.recent ? Math.max(30, n - opts.recent) : 30;
    const truth = { stockout: [], shift: -1, shiftRatio: 1, spike: [], neg: [], flat: [], tail: [], miss: [], block: [], gapDates: [], dupDates: [] };
    const free = (i, len) => { for (let k = 0; k < len; k++) if (i + k >= n - 5 || used.has(i + k) || (ds.event && ds.event[i + k])) return false; return true; };
    const take = len => { for (let tries = 0; tries < 400; tries++) { const i = r.int(lo0, n - 8 - len); if (free(i, len)) { for (let k = 0; k < len; k++) used.add(i + k); return i; } } return -1; };
    const stock = new Array(n).fill(1); // 库存标记：0 = 当天缺货
    if (kinds.stockout) for (let w = 0; w < 4; w++) { const len = r.int(4, 6), i = take(len); if (i < 0) continue; for (let k = 0; k < len; k++) { y[i + k] = Math.round(y[i + k] * (0.05 + 0.3 * r())); stock[i + k] = 0; truth.stockout.push(i + k); } }
    if (kinds.shift) { const i = (opts.recent ? n - Math.round(opts.recent * 0.55) : Math.round(n * 0.55)) + r.int(-15, 15); truth.shift = i; truth.shiftRatio = 0.72; for (let t = i; t < n; t++) y[t] = Math.round(y[t] * 0.72); }
    if (kinds.spike) for (let w = 0; w < 7; w++) { const i = take(1); if (i < 0) continue; y[i] = Math.round(y[i] * (2.2 + 1.3 * r())); truth.spike.push(i); }
    if (kinds.neg) for (let w = 0; w < 3; w++) { const i = take(1); if (i < 0) continue; y[i] = -Math.round(y[i] * (0.2 + 0.4 * r())); truth.neg.push(i); }
    if (kinds.flat) { const i = take(6); if (i >= 0) for (let k = 1; k < 6; k++) { y[i + k] = y[i]; truth.flat.push(i + k); } }
    if (kinds.tail) [0.82, 0.55, 0.28].forEach((f, k) => { const i = n - 3 + k; y[i] = Math.round(y[i] * f); truth.tail.push(i); });
    if (kinds.miss) for (let w = 0; w < Math.round((opts.recent || n) * 0.02) + 2; w++) { const i = take(1); if (i < 0) continue; y[i] = NaN; truth.miss.push(i); }
    if (kinds.block) { const i = take(9); if (i >= 0) for (let k = 0; k < 9; k++) { y[i + k] = NaN; truth.block.push(i + k); } }
    // 行级问题：整行不存在 / 重复上报（原始表不是规整序列）
    let rows = ds.dates.map((d, i) => ({ date: d, value: y[i] }));
    if (kinds.gap) { const drop = new Set(); for (let w = 0; w < 10; w++) { const i = take(1); if (i >= 0) { drop.add(i); truth.gapDates.push(ds.dates[i]); } } rows = rows.filter((_, i) => !drop.has(i)); }
    if (kinds.dup) for (let w = 0; w < 8; w++) { const j = r.int(Math.min(lo0, rows.length - 40), rows.length - 30), src = rows[j]; if (!Number.isFinite(src.value)) continue; truth.dupDates.push(src.date); rows.splice(j + 1, 0, { date: src.date, value: w % 2 ? src.value : Math.round(src.value * (1.02 + 0.06 * r())) }); }
    return { rows, y, stock, truth };
  };

  const C = TS.clean = {};
  // 第一步永远是"对齐时间轴"：补全缺失日期（填 NaN）、合并重复行
  C.align = function (rows, rule) {
    const by = new Map(); let dup = 0, unordered = 0;
    rows.forEach((r, i) => {
      if (i && r.date < rows[i - 1].date) unordered++;
      const k = TS.dayIndex(r.date);
      if (by.has(k)) { dup++; by.get(k).push(r.value); } else by.set(k, [r.value]);
    });
    let lo = Infinity, hi = -Infinity; by.forEach((_, k) => { if (k < lo) lo = k; if (k > hi) hi = k; });
    const dates = [], y = []; let gaps = 0;
    for (let k = lo; k <= hi; k++) {
      dates.push(TS.dayStr(k));
      const v = by.get(k);
      if (!v) { y.push(NaN); gaps++; continue; }
      const vals = v.filter(Number.isFinite);
      y.push(!vals.length ? NaN : rule === 'first' ? vals[0] : rule === 'sum' ? sum(vals) : rule === 'mean' ? mean(vals) : rule === 'max' ? Math.max.apply(null, vals) : vals[vals.length - 1]);
    }
    return { dates, y, dup, gaps, unordered };
  };
  // 缺失值填充。method: zero | mean | ffill | linear | seasonal（局部水平 × 季节指数）
  C.impute = function (y, method, m) {
    const n = y.length, out = y.slice(), miss = i => !Number.isFinite(y[i]);
    const linear = i => {
      let a = i - 1; while (a >= 0 && miss(a)) a--;
      let b = i + 1; while (b < n && miss(b)) b++;
      if (a < 0 && b >= n) return 0; if (a < 0) return y[b]; if (b >= n) return y[a];
      return y[a] + (y[b] - y[a]) * (i - a) / (b - a);
    };
    const mu = method === 'mean' ? TS.nanmean(y) : 0;
    let lvl = null, idx = null;
    if (method === 'seasonal') { // 局部水平（前后各 2 个周期的中位数）× 该相位的季节指数；中位数不怕旁边的大促尖峰
      lvl = C.rollMedian(y, 2 * m); idx = [];
      for (let ph = 0; ph < m; ph++) { const v = []; for (let i = ph; i < n; i += m) if (!miss(i) && lvl[i] > 0) v.push(y[i] / lvl[i]); idx.push(v.length ? median(v) : 1); }
    }
    for (let i = 0; i < n; i++) {
      if (!miss(i)) continue;
      if (method === 'zero') out[i] = 0;
      else if (method === 'mean') out[i] = mu;
      else if (method === 'ffill') { let a = i - 1; while (a >= 0 && miss(a)) a--; out[i] = a >= 0 ? y[a] : linear(i); }
      else if (method === 'seasonal') out[i] = Number.isFinite(lvl[i]) ? lvl[i] * idx[i % m] : linear(i);
      else out[i] = linear(i);
    }
    return out;
  };
  C.rollMedian = function (y, k) {
    const n = y.length, out = new Array(n);
    for (let i = 0; i < n; i++) { const w = []; for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) if (Number.isFinite(y[j])) w.push(y[j]); out[i] = w.length ? median(w) : NaN; }
    return out;
  };
  // 异常检测。method: sigma(全局3σ) | iqr(箱线图) | hampel(滚动中位数±MAD) | resid(去趋势去季节后的残差±MAD)
  // 返回 {flag[], lo[], hi[], expected[]}：flag 为是否越界，lo/hi 为判定带
  C.outliers = function (y, o) {
    o = o || {};
    const method = o.method || 'resid', thr = o.thr == null ? 3 : o.thr, n = y.length, m = o.m || 7;
    const useLog = !!o.log && (method === 'hampel' || method === 'resid');
    const x = useLog ? y.map(v => Number.isFinite(v) ? Math.log(Math.max(v, 1)) : NaN) : y;
    const ok = x.filter(Number.isFinite);
    let lo, hi, expected = null;
    if (method === 'sigma') { const mu = mean(ok), sd = std(ok); lo = new Array(n).fill(mu - thr * sd); hi = new Array(n).fill(mu + thr * sd); }
    else if (method === 'iqr') { const q1 = quantile(ok, 0.25), q3 = quantile(ok, 0.75); lo = new Array(n).fill(q1 - thr * (q3 - q1)); hi = new Array(n).fill(q3 + thr * (q3 - q1)); }
    else if (method === 'hampel') {
      const k = o.k || 7, med = C.rollMedian(x, k), mad = C.rollMedian(x.map((v, i) => Math.abs(v - med[i])), k);
      expected = med; lo = med.map((v, i) => v - thr * 1.4826 * mad[i]); hi = med.map((v, i) => v + thr * 1.4826 * mad[i]);
    } else {
      const tr = C.rollMedian(x, 2 * m), det = x.map((v, i) => v - tr[i]), sea = [];
      for (let ph = 0; ph < m; ph++) { const vals = []; for (let i = ph; i < n; i += m) if (Number.isFinite(det[i])) vals.push(det[i]); sea.push(vals.length ? median(vals) : 0); }
      expected = x.map((_, i) => tr[i] + sea[i % m]);
      const sc = 1.4826 * median(x.map((v, i) => Math.abs(v - expected[i])).filter(Number.isFinite)) || 1e-9;
      lo = expected.map(v => v - thr * sc); hi = expected.map(v => v + thr * sc);
    }
    const back = a => a ? (useLog ? a.map(Math.exp) : a) : null;
    return { flag: x.map((v, i) => Number.isFinite(v) && (v < lo[i] || v > hi[i])), lo: back(lo), hi: back(hi), expected: back(expected) };
  };
  // 连续相同值（传感器/接口卡死）
  C.flatline = function (y, minRun) {
    minRun = minRun || 4; const runs = []; let s = 0;
    for (let i = 1; i <= y.length; i++) {
      if (i < y.length && Number.isFinite(y[i]) && y[i] === y[i - 1]) continue;
      if (i - s >= minRun) runs.push([s, i - 1]);
      s = i;
    }
    return runs;
  };
  // 去季节：每个相位除以它的季节指数（指数 = 该相位上 y / 滚动中位数 的中位数）
  C.deseason = function (y, m) {
    const tr = C.rollMedian(y, 2 * m), idx = [];
    for (let ph = 0; ph < m; ph++) { const v = []; for (let i = ph; i < y.length; i += m) if (Number.isFinite(y[i]) && tr[i] > 0) v.push(y[i] / tr[i]); idx.push(v.length ? median(v) : 1); }
    return y.map((v, i) => v / (idx[i % m] || 1));
  };
  // 水平突变点扫描：比较每个位置左右各 w 天的中位数（先去季节；w 取 8 个周期左右，短期促销影响不了中位数）
  // stat = (右中位数 - 左中位数) / 稳健标准差；|stat| 越大越像口径/水平突变
  C.changePoint = function (y, w) {
    w = w || 56; const n = y.length, curve = new Array(n).fill(NaN);
    let best = -1, bs = 0;
    for (let k = w; k <= n - w; k++) {
      const L = y.slice(k - w, k).filter(Number.isFinite), R = y.slice(k, k + w).filter(Number.isFinite);
      if (L.length < w / 2 || R.length < w / 2) continue;
      const mL = median(L), mR = median(R);
      const sc = 1.4826 * median(L.map(v => Math.abs(v - mL)).concat(R.map(v => Math.abs(v - mR)))) || 1e-9;
      const st = (mR - mL) / sc; curve[k] = st;
      if (Math.abs(st) > Math.abs(bs)) { bs = st; best = k; }
    }
    if (best < 0) return { idx: -1, stat: 0, curve, ratio: 1 };
    // 中位数很稳健，所以扫描曲线在突变点附近是个"平台"，峰值位置不准。
    // 精确定位：在候选点附近找"切成两段后，各自绕中位数的绝对偏差之和"最小的切点
    const a0 = Math.max(0, best - w), b0 = Math.min(n, best + w);
    let bk = best, bc = Infinity;
    for (let k = Math.max(a0 + 7, best - (w >> 1)); k <= Math.min(b0 - 7, best + (w >> 1)); k++) {
      const L = y.slice(a0, k).filter(Number.isFinite), R = y.slice(k, b0).filter(Number.isFinite), mL = median(L), mR = median(R);
      let c = 0; for (const v of L) c += Math.abs(v - mL); for (const v of R) c += Math.abs(v - mR);
      if (c < bc) { bc = c; bk = k; }
    }
    best = bk;
    // 比例只用突变点两侧各 21 天估计：窗口越短受趋势污染越小，太短又容易被促销带偏
    const wr = Math.min(w, 21);
    return { idx: best, stat: bs, curve, ratio: median(y.slice(best, best + wr).filter(Number.isFinite)) / median(y.slice(best - wr, best).filter(Number.isFinite)) };
  };
  // 缺货还原：把缺货日当缺失，用同相位邻居估计真实需求（不低于实际销量）
  C.uncensor = (y, stock, m) => { const est = C.impute(y.map((v, i) => stock[i] ? v : NaN), 'seasonal', m); return y.map((v, i) => stock[i] ? v : Math.max(v, Math.round(est[i]))); };
  // 一条龙清洗流水线（顺序很重要：先对齐，再把"不可信的值"统一置空，最后一次性填充）
  // o = {m, rule, stock:[按日对齐，0=缺货], event:[按日对齐，有值=已知事件，不当异常处理], thr}
  C.pipeline = function (rows, o) {
    o = o || {};
    const m = o.m || 7, log = [], al = C.align(rows, o.rule || 'last');
    let y = al.y.slice(), dates = al.dates.slice(), c = 0;
    log.push(['对齐时间轴', `补全 ${al.gaps} 个缺失日期，合并 ${al.dup} 条重复行`]);
    y = y.map(v => (Number.isFinite(v) && v < 0 ? (c++, NaN) : v)); log.push(['负值置空', c + ' 个']);
    c = 0; C.flatline(y, 4).forEach(r => { for (let i = r[0] + 1; i <= r[1]; i++) { y[i] = NaN; c++; } }); log.push(['卡死的重复值置空', c + ' 个']);
    c = 0; if (o.stock) y = y.map((v, i) => (o.stock[i] === 0 && Number.isFinite(v) ? (c++, NaN) : v)); log.push(['缺货日置空（稍后还原需求）', c + ' 天']);
    // 未到齐的尾部：最后一天明显偏低时，从尾部往前截掉连续偏低的日子（最多 5 天）
    let det = C.outliers(C.impute(y, 'seasonal', m), { method: 'resid', m, thr: o.thr || 4, log: true }), cut = 0;
    const low = i => Number.isFinite(y[i]) && y[i] < 0.95 * det.expected[i];
    if (Number.isFinite(y[y.length - 1]) && y[y.length - 1] < 0.7 * det.expected[y.length - 1]) while (cut < 5 && low(y.length - 1 - cut)) cut++;
    if (cut) { y = y.slice(0, -cut); dates = dates.slice(0, -cut); det = { flag: det.flag.slice(0, -cut) }; }
    log.push(['截掉未到齐的尾部', cut + ' 天']);
    c = 0; det.flag.forEach((f, i) => { if (f && Number.isFinite(y[i]) && !(o.event && o.event[i])) { y[i] = NaN; c++; } }); log.push(['异常点置空（已知促销/节假日除外）', c + ' 个']);
    const cp = C.changePoint(C.deseason(C.impute(y, 'seasonal', m), m), 8 * m), shifted = Math.abs(cp.stat) > 3.5;
    if (shifted) for (let i = 0; i < cp.idx; i++) y[i] *= cp.ratio;
    log.push(['口径突变对齐', shifted ? `${dates[cp.idx]} 起水平变为此前的 ${cp.ratio.toFixed(2)} 倍，已把此前的数据按比例换算到新口径` : '未发现']);
    c = y.filter(v => !Number.isFinite(v)).length;
    y = C.impute(y, 'seasonal', m).map(v => Math.round(v)); log.push(['季节填充所有空值', c + ' 个']);
    return { dates, y, log, cut, changePoint: shifted ? cp : null };
  };
  // 数据体检报告
  C.health = function (rows, m) {
    m = m || 7;
    const al = C.align(rows, 'last'), y = al.y, n = y.length, fin = y.filter(Number.isFinite);
    const filled = C.impute(y, 'seasonal', m);
    const out = C.outliers(filled, { method: 'resid', m, thr: 4, log: true });
    const cp = C.changePoint(C.deseason(filled, m), 8 * m);
    return {
      aligned: al, rows: rows.length, span: n, from: al.dates[0], to: al.dates[n - 1],
      missingDates: al.gaps, dupRows: al.dup, unordered: al.unordered, nullValues: n - fin.length - al.gaps,
      negatives: fin.filter(v => v < 0).length, zeros: fin.filter(v => v === 0).length,
      flatRuns: C.flatline(y, 4), outliers: out.flag.reduce((c, f, i) => c + (f && Number.isFinite(y[i]) ? 1 : 0), 0), outlierFlag: out.flag, expected: out.expected,
      changePoint: Math.abs(cp.stat) > 3.5 ? { idx: cp.idx, date: al.dates[cp.idx], ratio: cp.ratio, stat: cp.stat } : null, cpStat: cp.stat,
      tailRatio: [3, 2, 1].map(k => Number.isFinite(y[n - k]) ? y[n - k] / out.expected[n - k] : NaN),
    };
  };

  g.TS = TS;
  if (typeof module !== 'undefined' && module.exports) module.exports = TS;
})(typeof globalThis !== 'undefined' ? globalThis : window);
