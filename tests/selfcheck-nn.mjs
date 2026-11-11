// nnlib.js 的自检（由 selfcheck.mjs 调用）
export default function ({ TS, NN, ok, near, f }) {
  console.log('\n[nnlib] 反向传播的梯度检查（解析梯度 vs 数值梯度）');
  const r = TS.rng(3), vec = n => Array.from({ length: n }, () => r.n()), seq = (T, D) => Array.from({ length: T }, () => vec(D));
  const chk = (name, model, x, t) => { const e = NN.gradCheck(model, x, t, 80); ok(name, e < 1e-5, '最大相对误差 ' + e.toExponential(2)); };
  chk('MLP (tanh)', NN.mlp({ nin: 4, nh: 6, nout: 2, act: 'tanh', seed: 1 }), vec(4), vec(2));
  chk('MLP (sigmoid)', NN.mlp({ nin: 3, nh: 5, nout: 1, act: 'sigmoid', seed: 2 }), vec(3), vec(1));
  chk('RNN，序列长 12', NN.rnn({ nin: 2, nh: 5, nout: 1, cell: 'rnn', seed: 3 }), seq(12, 2), vec(1));
  chk('LSTM，序列长 12', NN.rnn({ nin: 2, nh: 5, nout: 1, cell: 'lstm', seed: 4 }), seq(12, 2), vec(1));
  chk('LSTM，多步输出', NN.rnn({ nin: 1, nh: 6, nout: 7, cell: 'lstm', seed: 5 }), seq(20, 1), vec(7));
  ok('参数量公式', NN.rnn({ nin: 3, nh: 8, nout: 2, cell: 'lstm' }).n === NN.paramCount('lstm', 3, 8, 2) && NN.rnn({ nin: 3, nh: 8, nout: 2, cell: 'rnn' }).n === NN.paramCount('rnn', 3, 8, 2));

  console.log('\n[nnlib] 训练');
  {
    const X = Array.from({ length: 200 }, (_, i) => [-2 + 4 * i / 199]), Y = X.map(x => [Math.sin(2 * x[0])]);
    const m = NN.mlp({ nin: 1, nh: 12, act: 'tanh', seed: 2 }), opt = NN.adam(m, 0.03), rng = TS.rng(1), l0 = NN.mse(m, X, Y);
    let l = l0; for (let e = 0; e < 150; e++) l = NN.trainEpoch(m, opt, X, Y, { batch: 16, rng });
    ok('MLP 学会 sin(2x)', l < 0.01 && l < l0 * 0.05, `MSE ${f(l0)} → ${f(l)}`);
  }
  {
    const z = Array.from({ length: 260 }, (_, t) => Math.sin(2 * Math.PI * t / 12) + 0.5 * Math.sin(2 * Math.PI * t / 5)), d = NN.windows(z, 16, 1);
    const tr = { X: d.X.slice(0, 180), Y: d.Y.slice(0, 180) }, te = { X: d.X.slice(180), Y: d.Y.slice(180) };
    const run = cell => { const m = NN.rnn({ nin: 1, nh: 10, cell, seed: 5 }), opt = NN.adam(m, 0.01), rng = TS.rng(2); for (let e = 0; e < 40; e++) NN.trainEpoch(m, opt, tr.X, tr.Y, { batch: 16, rng }); return NN.mse(m, te.X, te.Y); };
    const t0 = Date.now(), eL = run('lstm'), ms = Date.now() - t0;
    ok('LSTM 学会双周期正弦（测试 MSE 很小）', eL < 0.02, `MSE ${f(eL)}，40 轮耗时 ${ms}ms`);
  }
  {
    // 长依赖：第 1 步给一个数值（带"记住它"的标记），之后 19 步全是噪声，最后要把那个数值原样输出。
    // RNN 用常见的小权重初始化（gain≈0.58，相当于 PyTorch 默认），梯度传不回第 1 步；LSTM 可以。
    const T = 20, rg = TS.rng(9), mk = n => { const X = [], Y = []; for (let i = 0; i < n; i++) { const s = 2 * rg() - 1, q = [[s, 1]]; for (let t = 1; t < T; t++) q.push([0.5 * rg.n(), 0]); X.push(q); Y.push([s]); } return { X, Y }; };
    const tr = mk(300), te = mk(200), v = TS.variance(te.Y.map(y => y[0]));
    const run = o => { const m = NN.rnn(Object.assign({ nin: 2, nh: 8, seed: 11 }, o)), opt = NN.adam(m, 0.02), rng = TS.rng(4); for (let e = 0; e < 30; e++) NN.trainEpoch(m, opt, tr.X, tr.Y, { batch: 16, rng }); return 1 - NN.mse(m, te.X, te.Y) / v; };
    const aR = run({ cell: 'rnn', gain: 0.58 }), aL = run({ cell: 'lstm' });
    ok('记住 20 步之前的数值：LSTM 学会，RNN 学不会', aL > 0.9 && aR < 0.5, `R² RNN ${f(aR)} / LSTM ${f(aL)}`);
    const mR = NN.rnn({ nin: 1, nh: 8, cell: 'rnn', seed: 1, gain: 0.5 }), fR = mR.forward(tr.X[0]); mR.backward(fR.cache, [1]);
    ok('RNN 的梯度沿时间指数衰减', fR.cache.gradNorm[0] < fR.cache.gradNorm[T - 1] * 1e-4, `第 30 步 ${fR.cache.gradNorm[T - 1].toExponential(1)} → 第 1 步 ${fR.cache.gradNorm[0].toExponential(1)}`);
  }
}
