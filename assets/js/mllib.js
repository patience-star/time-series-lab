/* 时间序列实验室 · 机器学习库（全局对象 ML，依赖 TS）
 * 目录：特征构造（把序列变成表格）→ 岭回归 → 直方图回归树 → 随机森林 → GBDT → 递归多步预测
 * 树的实现采用 LightGBM 式的"直方图"做法：先把每个特征分成最多 32 个桶，找切分点时只扫桶。
 */
(function (g) {
  'use strict';
  const TS = g.TS;
  const ML = {};
  const mean = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; };

  /* ================= 特征构造 =================
   * cfg = {
   *   lags: [1,7,14]        滞后值 y[t-k]
   *   roll: [7,28]          过去 w 天的滚动均值（窗口止于 t-1，不含当天）
   *   rollStd: [7]          过去 w 天的滚动标准差
   *   dow / month / trend   日历特征；onehot=true 时星期用 7 个 0/1 列（线性模型需要）
   *   phase: m              周期内的位置 t % m（小时数据的"几点"）
   *   exog: ['temp']        外部变量：直接取 ds[名字][t]（必须是预测时已知或有预报的量）
   *   promo / holiday       已知的未来信息：促销计划、春节
   *   fourier: K            年周期的 K 对正余弦
   *   log: true             目标取对数
   *   rel: true             目标与滞后特征都减去"最近 7 天均值"——让树模型能跟上趋势
   *   leak: true            （反面教材）加入一个偷看了未来的"居中 3 日均值"特征（昨天、今天、明天的平均）
   * } */
  ML.target = (ds, cfg) => (cfg.log ? ds.y.map(v => Math.log(Math.max(v, 1))) : ds.y.slice());
  ML.inverse = (v, cfg) => (cfg.log ? Math.exp(v) : v);
  ML.base = (hist, t) => { let s = 0; for (let i = t - 7; i < t; i++) s += hist[i]; return s / 7; };
  ML.minT = cfg => Math.max(7, ...(cfg.lags || []), ...(cfg.roll || []), ...(cfg.rollStd || []));

  ML.featNames = function (cfg) {
    const n = [];
    (cfg.lags || []).forEach(k => n.push('滞后' + k));
    (cfg.roll || []).forEach(w => n.push('近' + w + '日均值'));
    (cfg.rollStd || []).forEach(w => n.push('近' + w + '日波动'));
    if (cfg.dow) { if (cfg.onehot) for (let k = 0; k < 7; k++) n.push('星期=' + TS.DOW[k]); else n.push('星期几'); }
    if (cfg.phase) { if (cfg.onehot) for (let k = 0; k < cfg.phase; k++) n.push('时段=' + k); else n.push('时段'); }
    if (cfg.month) n.push('月份');
    if (cfg.trend) n.push('时间趋势');
    (cfg.exog || []).forEach(k => n.push('外部:' + k));
    if (cfg.promo) { n.push('促销'); n.push('大促当天'); }
    if (cfg.holiday) n.push('春节');
    for (let k = 1; k <= (cfg.fourier || 0); k++) { n.push('年周期sin' + k); n.push('年周期cos' + k); }
    if (cfg.leak) n.push('居中3日均值(泄漏)');
    return n;
  };
  // 特征分组（用于汇总重要性）：把 one-hot、成对的列归到一组
  ML.featGroup = name => name.startsWith('星期') ? '星期几' : name.startsWith('时段') ? '时段' : name.startsWith('年周期') ? '年周期' : (name === '促销' || name === '大促当天') ? '促销' : name;

  // 生成第 t 天的特征行。hist：t 之前的（变换后的）目标值；预测未来时其中包含模型自己的预测。
  // peek=true 仅用于演示泄漏：允许"居中均值"特征读取 t 当天及之后的真实值。
  ML.featRow = function (hist, t, ds, cfg, peek) {
    const row = [], b = cfg.rel ? ML.base(hist, t) : 0;
    (cfg.lags || []).forEach(k => row.push(hist[t - k] - b));
    (cfg.roll || []).forEach(w => { let s = 0; for (let i = t - w; i < t; i++) s += hist[i]; row.push(s / w - b); });
    (cfg.rollStd || []).forEach(w => { let s = 0, q = 0; for (let i = t - w; i < t; i++) { s += hist[i]; q += hist[i] * hist[i]; } row.push(Math.sqrt(Math.max(0, q / w - (s / w) * (s / w)))); });
    const d = ds.dates[t];
    if (cfg.dow) { const w = TS.dow(d); if (cfg.onehot) for (let k = 0; k < 7; k++) row.push(+(w === k)); else row.push(w); }
    if (cfg.phase) { const ph = t % cfg.phase; if (cfg.onehot) for (let k = 0; k < cfg.phase; k++) row.push(+(ph === k)); else row.push(ph); }
    if (cfg.month) row.push(+d.slice(5, 7));
    if (cfg.trend) row.push(t / 365);
    (cfg.exog || []).forEach(k => row.push(ds[k][t]));
    if (cfg.promo) { row.push(ds.promo[t]); row.push(+(ds.event[t] === '618' || ds.event[t] === '双11')); }
    if (cfg.holiday) row.push(ds.holiday[t]);
    if (cfg.fourier) { const doy = (TS.dayIndex(d) - TS.dayIndex(d.slice(0, 4) + '-01-01')) / 365.25; for (let k = 1; k <= cfg.fourier; k++) { row.push(Math.sin(2 * Math.PI * k * doy)); row.push(Math.cos(2 * Math.PI * k * doy)); } }
    if (cfg.leak) { // 训练/验证时用真实值（含当天和明天）；真正预测时这些值不存在，只能用已有的部分
      const src = peek ? ML.target(ds, cfg) : hist; let s = 0, c = 0;
      for (let i = t - 1; i <= t + 1; i++) if (i < src.length) { s += src[i]; c++; }
      row.push(s / c - b);
    }
    return row;
  };

  // 生成 [a, b) 区间的训练表
  ML.makeXY = function (ds, cfg, a, b, peek) {
    const yT = ML.target(ds, cfg), X = [], y = [], idx = [];
    for (let t = Math.max(a, ML.minT(cfg)); t < b; t++) {
      X.push(ML.featRow(yT, t, ds, cfg, peek !== false));
      y.push(yT[t] - (cfg.rel ? ML.base(yT, t) : 0)); idx.push(t);
    }
    return { X, y, idx, names: ML.featNames(cfg) };
  };

  // 递归多步预测：预测一步 → 把预测值当作已知，继续预测下一步
  ML.forecast = function (model, ds, cfg, cut, h) {
    const hist = ML.target(ds, cfg).slice(0, cut), out = [];
    for (let j = 0; j < h; j++) {
      const t = cut + j, p = model.predict(ML.featRow(hist, t, ds, cfg, false)) + (cfg.rel ? ML.base(hist, t) : 0);
      hist.push(p); out.push(ML.inverse(p, cfg));
    }
    return out;
  };
  // "一步向前"预测：每一步都用真实历史（等价于每天重新预测明天）。peek 控制泄漏特征是否偷看
  ML.oneStep = function (model, ds, cfg, a, b, peek) {
    const yT = ML.target(ds, cfg), out = [];
    for (let t = a; t < b; t++) out.push(ML.inverse(model.predict(ML.featRow(yT, t, ds, cfg, !!peek)) + (cfg.rel ? ML.base(yT, t) : 0), cfg));
    return out;
  };

  /* ================= 岭回归（特征标准化后求解） ================= */
  ML.ridge = function (X, y, lambda) {
    const n = X.length, F = X[0].length, mu = new Array(F).fill(0), sd = new Array(F).fill(0), ym = mean(y);
    for (let i = 0; i < n; i++) for (let j = 0; j < F; j++) mu[j] += X[i][j] / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < F; j++) sd[j] += (X[i][j] - mu[j]) ** 2 / n;
    for (let j = 0; j < F; j++) sd[j] = Math.sqrt(sd[j]) || 1;
    const Xs = X.map(r => r.map((v, j) => (v - mu[j]) / sd[j]));
    const beta = TS.ols(Xs, y.map(v => v - ym), lambda == null ? 1 : lambda).beta;
    return { beta, predict: row => { let s = ym; for (let j = 0; j < F; j++) s += beta[j] * (row[j] - mu[j]) / sd[j]; return s; }, importance: beta.map(Math.abs) };
  };

  /* ================= 直方图分桶 ================= */
  ML.bin = function (X, maxBins) {
    maxBins = maxBins || 32;
    const n = X.length, F = X[0].length, B = new Uint8Array(n * F), edges = [];
    for (let f = 0; f < F; f++) {
      const col = X.map(r => r[f]).sort((a, b) => a - b), uniq = [];
      for (let i = 0; i < n; i++) if (!i || col[i] !== col[i - 1]) uniq.push(col[i]);
      let thr = [];
      if (uniq.length <= maxBins) for (let i = 0; i + 1 < uniq.length; i++) thr.push((uniq[i] + uniq[i + 1]) / 2);
      else for (let q = 1; q < maxBins; q++) { const v = col[Math.floor(q * n / maxBins)]; if (!thr.length || v > thr[thr.length - 1]) thr.push(v); }
      edges.push(thr);
      for (let i = 0; i < n; i++) { const v = X[i][f]; let lo = 0, hi = thr.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (v > thr[mid]) lo = mid + 1; else hi = mid; } B[i * F + f] = lo; }
    }
    return { B, edges, n, F };
  };

  /* ================= 回归树（CART，按"方差减少量"选切分） =================
   * 增益 = SL²/(nL+λ) + SR²/(nR+λ) − S²/(n+λ)，其中 S 是目标值之和。λ=0 时就是方差减少量。 */
  function grow(bins, gArr, idxs, o, rng, imp) {
    const { B, edges, F } = bins, lam = o.lambda || 0, minLeaf = o.minLeaf || 1;
    const rec = (ids, depth) => {
      let S = 0; for (let i = 0; i < ids.length; i++) S += gArr[ids[i]];
      const cnt = ids.length, leaf = { leaf: true, value: S / (cnt + lam), n: cnt };
      if (depth >= (o.maxDepth == null ? 3 : o.maxDepth) || cnt < 2 * minLeaf) return leaf;
      let best = null;
      for (let f = 0; f < F; f++) {
        if (o.featFrac && o.featFrac < 1 && rng() > o.featFrac) continue;
        const nb = edges[f].length + 1; if (nb < 2) continue;
        const hs = new Float64Array(nb), hc = new Uint32Array(nb);
        for (let i = 0; i < cnt; i++) { const b = B[ids[i] * F + f]; hs[b] += gArr[ids[i]]; hc[b]++; }
        let sl = 0, cl = 0;
        for (let b = 0; b < nb - 1; b++) {
          sl += hs[b]; cl += hc[b]; const cr = cnt - cl;
          if (cl < minLeaf || cr < minLeaf) continue;
          const gain = sl * sl / (cl + lam) + (S - sl) * (S - sl) / (cr + lam) - S * S / (cnt + lam);
          if (!best || gain > best.gain) best = { f, b, gain };
        }
      }
      if (!best || best.gain <= 1e-12) return leaf;
      const L = [], R = [];
      for (let i = 0; i < cnt; i++) (B[ids[i] * F + best.f] <= best.b ? L : R).push(ids[i]);
      if (imp) imp[best.f] += best.gain;
      return { f: best.f, bin: best.b, thr: edges[best.f][best.b], gain: best.gain, n: cnt, value: leaf.value, left: rec(L, depth + 1), right: rec(R, depth + 1) };
    };
    return rec(idxs, 0);
  }
  const walk = (node, row) => { while (!node.leaf) node = row[node.f] <= node.thr ? node.left : node.right; return node.value; };
  const walkBin = (node, B, i, F) => { while (!node.leaf) node = B[i * F + node.f] <= node.bin ? node.left : node.right; return node.value; };
  const allIdx = n => Array.from({ length: n }, (_, i) => i);
  ML.walk = walk;                                                         // 单棵树的预测：ML.walk(tree, row)
  ML.leaves = node => (node.leaf ? 1 : ML.leaves(node.left) + ML.leaves(node.right));

  ML.tree = function (X, y, o) {
    o = o || {};
    const bins = ML.bin(X, o.maxBins), imp = new Float64Array(bins.F);
    const root = grow(bins, y, allIdx(X.length), o, TS.rng(o.seed || 1), imp);
    return { root, predict: row => walk(root, row), importance: Array.from(imp) };
  };

  /* ================= 随机森林：自助采样 + 随机选特征，多棵深树取平均 ================= */
  ML.forest = function (X, y, o) {
    o = o || {};
    const n = X.length, bins = ML.bin(X, o.maxBins), rng = TS.rng(o.seed || 1), imp = new Float64Array(bins.F), trees = [];
    const opt = { maxDepth: o.maxDepth == null ? 8 : o.maxDepth, minLeaf: o.minLeaf || 3, featFrac: o.featFrac == null ? 0.6 : o.featFrac };
    for (let m = 0; m < (o.nTrees || 50); m++) {
      const ids = []; for (let i = 0; i < n; i++) ids.push(rng.int(0, n - 1));
      trees.push(grow(bins, y, ids, opt, rng, imp));
    }
    const predictK = (row, k) => { let s = 0; for (let m = 0; m < k; m++) s += walk(trees[m], row); return s / k; };
    return { trees, predict: row => predictK(row, trees.length), predictK, predictTree: (row, m) => walk(trees[m], row), importance: Array.from(imp) };
  };

  /* ================= GBDT：每一轮用一棵浅树去拟合"当前的残差" =================
   * F_0 = 均值；第 m 轮：r_i = y_i − F_{m-1}(x_i)，树 h_m 拟合 r，F_m = F_{m-1} + 学习率 × h_m
   * （平方损失下残差就是负梯度；XGBoost / LightGBM 在此基础上加入二阶信息、正则与工程优化） */
  ML.gbdt = function (X, y, o) {
    o = o || {};
    const n = X.length, bins = ML.bin(X, o.maxBins), F = bins.F, rng = TS.rng(o.seed || 1), imp = new Float64Array(F);
    const lr = o.lr == null ? 0.1 : o.lr, nTrees = o.nTrees || 100, sub = o.subsample || 1;
    const opt = { maxDepth: o.maxDepth == null ? 3 : o.maxDepth, minLeaf: o.minLeaf || 5, featFrac: o.featFrac, lambda: o.lambda || 0 };
    const base = mean(y), cur = new Float64Array(n).fill(base), res = new Float64Array(n), trees = [], trainLoss = [], validLoss = [];
    const V = o.valid, curV = V ? new Float64Array(V.X.length).fill(base) : null;
    for (let m = 0; m < nTrees; m++) {
      for (let i = 0; i < n; i++) res[i] = y[i] - cur[i];
      let ids = allIdx(n); if (sub < 1) ids = ids.filter(() => rng() < sub);
      const tree = grow(bins, res, ids, opt, rng, imp); trees.push(tree);
      let loss = 0; for (let i = 0; i < n; i++) { cur[i] += lr * walkBin(tree, bins.B, i, F); loss += (y[i] - cur[i]) ** 2; }
      trainLoss.push(loss / n);
      if (V) { let lv = 0; for (let i = 0; i < V.X.length; i++) { curV[i] += lr * walk(tree, V.X[i]); lv += (V.y[i] - curV[i]) ** 2; } validLoss.push(lv / V.X.length); }
    }
    const predictK = (row, k) => { let s = base; for (let m = 0; m < k; m++) s += lr * walk(trees[m], row); return s; };
    return { base, lr, trees, predict: row => predictK(row, trees.length), predictK, trainLoss, validLoss, importance: Array.from(imp) };
  };

  // 按特征组汇总并归一化的重要性：[[组名, 占比], …]，从大到小
  ML.groupImportance = function (imp, names) {
    const m = new Map(); let tot = 0;
    imp.forEach((v, i) => { const k = ML.featGroup(names[i]); m.set(k, (m.get(k) || 0) + v); tot += v; });
    return [...m.entries()].map(e => [e[0], tot > 0 ? e[1] / tot : 0]).sort((a, b) => b[1] - a[1]);
  };

  g.ML = ML;
  if (typeof module !== 'undefined' && module.exports) module.exports = ML;
})(typeof globalThis !== 'undefined' ? globalThis : window);
