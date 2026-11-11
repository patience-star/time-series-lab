/* 时间序列实验室 · 神经网络库（全局对象 NN，依赖 TS 的随机数）
 * 手写的 MLP、RNN、LSTM：前向传播、反向传播（BPTT）、Adam 优化器、梯度检查。
 * 所有参数放在一个一维数组 model.w 里，梯度在 model.g 里——这样优化器和梯度检查对任何模型通用。
 * 规模定位：隐藏单元几个到几十个，够教学演示在浏览器里实时训练；不是生产实现。
 */
(function (g) {
  'use strict';
  const TS = g.TS;
  const NN = {};
  const sig = x => 1 / (1 + Math.exp(-x));
  const ACT = {
    tanh: { f: Math.tanh, d: y => 1 - y * y },           // 导数都写成"关于输出值 y"的形式
    sigmoid: { f: sig, d: y => y * (1 - y) },
    relu: { f: x => (x > 0 ? x : 0), d: y => (y > 0 ? 1 : 0) },
    linear: { f: x => x, d: () => 1 },
  };
  NN.ACT = ACT;

  function finish(m) { // 给模型补上通用方法
    m.n = m.w.length;
    m.zeroGrad = () => m.g.fill(0);
    m.predict = x => Array.from(m.forward(x).y);
    m.loss = (x, t) => { const y = m.forward(x).y; let s = 0; for (let k = 0; k < y.length; k++) s += 0.5 * (y[k] - t[k]) ** 2; return s; };
    // 单个样本：前向 → 算损失 ½Σ(y−t)² → 反向，把梯度累加进 m.g
    m.sampleGrad = (x, t) => {
      const f = m.forward(x), dy = new Float64Array(f.y.length); let s = 0;
      for (let k = 0; k < dy.length; k++) { dy[k] = f.y[k] - t[k]; s += 0.5 * dy[k] * dy[k]; }
      m.backward(f.cache, dy);
      return s;
    };
    return m;
  }

  /* ================= MLP：输入 → 一个隐藏层 → 输出 ================= */
  NN.mlp = function (o) {
    const D = o.nin, H = o.nh, O = o.nout || 1, act = ACT[o.act || 'tanh'], r = TS.rng(o.seed || 1);
    const oW1 = 0, ob1 = H * D, oW2 = ob1 + H, ob2 = oW2 + O * H, w = new Float64Array(ob2 + O), gr = new Float64Array(w.length);
    for (let i = 0; i < H * D; i++) w[oW1 + i] = r.n() * (o.initScale || 1) / Math.sqrt(D);
    for (let i = 0; i < O * H; i++) w[oW2 + i] = r.n() / Math.sqrt(H);
    if (o.act === 'relu' || o.spreadBias) for (let j = 0; j < H; j++) w[ob1 + j] = r.n() * 0.5;
    const m = { kind: 'mlp', w, g: gr, shape: { D, H, O }, off: { W1: oW1, b1: ob1, W2: oW2, b2: ob2 } };
    m.forward = function (x) {
      const h = new Float64Array(H), y = new Float64Array(O);
      for (let j = 0; j < H; j++) { let a = w[ob1 + j]; for (let i = 0; i < D; i++) a += w[oW1 + j * D + i] * x[i]; h[j] = act.f(a); }
      for (let k = 0; k < O; k++) { let a = w[ob2 + k]; for (let j = 0; j < H; j++) a += w[oW2 + k * H + j] * h[j]; y[k] = a; }
      return { y, cache: { x, h } };
    };
    m.backward = function (c, dy) {
      const dh = new Float64Array(H);
      for (let k = 0; k < O; k++) { gr[ob2 + k] += dy[k]; for (let j = 0; j < H; j++) { gr[oW2 + k * H + j] += dy[k] * c.h[j]; dh[j] += w[oW2 + k * H + j] * dy[k]; } }
      for (let j = 0; j < H; j++) { const da = dh[j] * act.d(c.h[j]); gr[ob1 + j] += da; for (let i = 0; i < D; i++) gr[oW1 + j * D + i] += da * c.x[i]; }
    };
    return finish(m);
  };

  /* ================= 循环网络：RNN 与 LSTM =================
   * 输入是一段序列 seq = [x_1, …, x_T]（每个 x_t 是长度 D 的向量），只在最后一步接一个线性输出层。
   * RNN ：h_t = tanh(Wx·x_t + Wh·h_{t-1} + b)
   * LSTM：z = [x_t, h_{t-1}]
   *        i = σ(Wi·z+bi)  输入门      f = σ(Wf·z+bf)  遗忘门
   *        o = σ(Wo·z+bo)  输出门      g = tanh(Wg·z+bg) 候选记忆
   *        c_t = f ⊙ c_{t-1} + i ⊙ g   细胞状态（长期记忆的"传送带"）
   *        h_t = o ⊙ tanh(c_t)         隐藏状态（对外的输出） */
  NN.rnn = function (o) {
    const D = o.nin, H = o.nh, O = o.nout || 1, lstm = o.cell === 'lstm', G = lstm ? 4 : 1, Z = D + H, r = TS.rng(o.seed || 1);
    const oW = 0, ob = G * H * Z, oWy = ob + G * H, oby = oWy + O * H, w = new Float64Array(oby + O), gr = new Float64Array(w.length);
    for (let k = 0; k < G * H; k++) for (let j = 0; j < Z; j++) w[oW + k * Z + j] = r.n() * (j < D ? 1 / Math.sqrt(D) : (o.gain == null ? 1 : o.gain) / Math.sqrt(H));
    if (lstm) for (let j = 0; j < H; j++) w[ob + H + j] = o.fbias == null ? 1 : o.fbias; // 遗忘门偏置初始化为正数：默认"先记住"
    for (let i = 0; i < O * H; i++) w[oWy + i] = r.n() / Math.sqrt(H);
    const m = { kind: lstm ? 'lstm' : 'rnn', w, g: gr, shape: { D, H, O, Z, G }, off: { W: oW, b: ob, Wy: oWy, by: oby } };

    m.forward = function (seq) {
      const T = seq.length, zs = [], hs = [new Float64Array(H)], cs = [new Float64Array(H)], gates = [], tcs = [];
      for (let t = 0; t < T; t++) {
        const z = new Float64Array(Z), hp = hs[t], x = seq[t];
        for (let i = 0; i < D; i++) z[i] = x[i];
        for (let j = 0; j < H; j++) z[D + j] = hp[j];
        const a = new Float64Array(G * H);
        for (let k = 0; k < G * H; k++) { let s = w[ob + k]; const base = oW + k * Z; for (let j = 0; j < Z; j++) s += w[base + j] * z[j]; a[k] = s; }
        const h = new Float64Array(H);
        if (lstm) {
          const c = new Float64Array(H), tc = new Float64Array(H), cp = cs[t];
          for (let j = 0; j < H; j++) {
            a[j] = sig(a[j]); a[H + j] = sig(a[H + j]); a[2 * H + j] = sig(a[2 * H + j]); a[3 * H + j] = Math.tanh(a[3 * H + j]);
            c[j] = a[H + j] * cp[j] + a[j] * a[3 * H + j]; tc[j] = Math.tanh(c[j]); h[j] = a[2 * H + j] * tc[j];
          }
          cs.push(c); tcs.push(tc);
        } else for (let j = 0; j < H; j++) h[j] = a[j] = Math.tanh(a[j]);   // a 里存激活后的值，反向时用
        zs.push(z); gates.push(a); hs.push(h);
      }
      const y = new Float64Array(O), hT = hs[T];
      for (let k = 0; k < O; k++) { let s = w[oby + k]; for (let j = 0; j < H; j++) s += w[oWy + k * H + j] * hT[j]; y[k] = s; }
      return { y, cache: { T, zs, hs, cs, gates, tcs } };
    };

    // 沿时间反向传播（BPTT）。cache.gradNorm[t] 记录误差信号传回到第 t 步时的大小——用来演示梯度消失
    m.backward = function (c, dy) {
      const T = c.T, hT = c.hs[T];
      let dh = new Float64Array(H), dc = new Float64Array(H);
      for (let k = 0; k < O; k++) { gr[oby + k] += dy[k]; for (let j = 0; j < H; j++) { gr[oWy + k * H + j] += dy[k] * hT[j]; dh[j] += w[oWy + k * H + j] * dy[k]; } }
      c.gradNorm = new Array(T);
      for (let t = T - 1; t >= 0; t--) {
        let nrm = 0; for (let j = 0; j < H; j++) nrm += dh[j] * dh[j] + dc[j] * dc[j];
        c.gradNorm[t] = Math.sqrt(nrm);
        const a = c.gates[t], z = c.zs[t], da = new Float64Array(G * H), dcp = new Float64Array(H);
        if (lstm) {
          const tc = c.tcs[t], cp = c.cs[t];
          for (let j = 0; j < H; j++) {
            const i = a[j], f = a[H + j], og = a[2 * H + j], gg = a[3 * H + j];
            const dct = dc[j] + dh[j] * og * (1 - tc[j] * tc[j]);
            da[j] = dct * gg * i * (1 - i); da[H + j] = dct * cp[j] * f * (1 - f);
            da[2 * H + j] = dh[j] * tc[j] * og * (1 - og); da[3 * H + j] = dct * i * (1 - gg * gg);
            dcp[j] = dct * f;                           // 细胞状态的梯度只乘以遗忘门 f —— 不经过 tanh 压缩，这就是 LSTM 记得久的原因
          }
        } else for (let j = 0; j < H; j++) da[j] = dh[j] * (1 - a[j] * a[j]);
        const dz = new Float64Array(Z);
        for (let k = 0; k < G * H; k++) { const v = da[k]; if (v === 0) continue; gr[ob + k] += v; const base = oW + k * Z; for (let j = 0; j < Z; j++) { gr[base + j] += v * z[j]; dz[j] += w[base + j] * v; } }
        dh = dz.subarray(D); dc = dcp;
      }
    };
    return finish(m);
  };

  /* ================= 优化器 ================= */
  // Adam：每个参数有自己的自适应步长。step() 使用 model.g 里的梯度；clip 为梯度范数上限（防爆炸）
  NN.adam = function (model, lr, o) {
    o = o || {};
    const n = model.n, mo = new Float64Array(n), v = new Float64Array(n), b1 = 0.9, b2 = 0.999; let t = 0;
    return {
      lr,
      step(clip) {
        const gArr = model.g, w = model.w; let sc = 1;
        if (clip) { let s = 0; for (let i = 0; i < n; i++) s += gArr[i] * gArr[i]; s = Math.sqrt(s); if (s > clip) sc = clip / s; }
        t++; const c1 = 1 - Math.pow(b1, t), c2 = 1 - Math.pow(b2, t);
        for (let i = 0; i < n; i++) { const gi = gArr[i] * sc; mo[i] = b1 * mo[i] + (1 - b1) * gi; v[i] = b2 * v[i] + (1 - b2) * gi * gi; w[i] -= this.lr * (mo[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8); }
      },
    };
  };
  NN.sgd = (model, lr) => ({ lr, step() { for (let i = 0; i < model.n; i++) model.w[i] -= this.lr * model.g[i]; } });

  // 训练一轮（遍历全部样本一次）。返回平均 MSE。o = {batch, rng, clip}
  NN.trainEpoch = function (model, opt, X, Y, o) {
    o = o || {};
    const n = X.length, bs = o.batch || 16, idx = Array.from({ length: n }, (_, i) => i), rng = o.rng;
    if (rng) for (let i = n - 1; i > 0; i--) { const j = rng.int(0, i), tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp; }
    let tot = 0;
    for (let s = 0; s < n; s += bs) {
      const e = Math.min(n, s + bs); model.zeroGrad();
      for (let q = s; q < e; q++) tot += model.sampleGrad(X[idx[q]], Y[idx[q]]);
      const inv = 1 / (e - s); for (let i = 0; i < model.n; i++) model.g[i] *= inv;
      opt.step(o.clip == null ? 5 : o.clip);
    }
    return 2 * tot / (n * Y[0].length);
  };
  NN.mse = function (model, X, Y) { let s = 0; for (let i = 0; i < X.length; i++) s += model.loss(X[i], Y[i]); return 2 * s / (X.length * Y[0].length); };

  // 梯度检查：解析梯度（反向传播）与数值梯度（有限差分）的最大相对误差。反向传播写错了它会很大
  NN.gradCheck = function (model, x, t, nCheck) {
    model.zeroGrad(); model.sampleGrad(x, t);
    const ana = Float64Array.from(model.g), eps = 1e-5, r = TS.rng(7); let worst = 0;
    for (let q = 0; q < (nCheck || 60); q++) {
      const i = r.int(0, model.n - 1), old = model.w[i];
      model.w[i] = old + eps; const lp = model.loss(x, t);
      model.w[i] = old - eps; const lm = model.loss(x, t);
      model.w[i] = old;
      const num = (lp - lm) / (2 * eps), rel = Math.abs(num - ana[i]) / Math.max(1e-7, Math.abs(num) + Math.abs(ana[i]));
      if (rel > worst) worst = rel;
    }
    model.zeroGrad();
    return worst;
  };

  /* ================= 数据准备 ================= */
  // 标准化：只用训练段的均值和标准差（否则就是泄漏）
  NN.scaler = function (arr) { const mu = TS.mean(arr), sd = TS.std(arr) || 1; return { mu, sd, f: v => (v - mu) / sd, inv: v => v * sd + mu }; };
  // 滑动窗口：X[i] = 长度 win 的序列（每步一个向量），Y[i] = 之后的 h 个值。feat(t) 可为每一步追加协变量
  NN.windows = function (z, win, h, feat) {
    const X = [], Y = [], at = [];
    for (let i = 0; i + win + h <= z.length; i++) {
      const seq = []; for (let t = i; t < i + win; t++) seq.push(feat ? [z[t]].concat(feat(t)) : [z[t]]);
      X.push(seq); Y.push(z.slice(i + win, i + win + h)); at.push(i + win);
    }
    return { X, Y, at };
  };
  NN.paramCount = (cell, D, H, O) => (cell === 'lstm' ? 4 : cell === 'gru' ? 3 : 1) * H * (D + H + 1) + (O || 1) * (H + 1);

  g.NN = NN;
  if (typeof module !== 'undefined' && module.exports) module.exports = NN;
})(typeof globalThis !== 'undefined' ? globalThis : window);
