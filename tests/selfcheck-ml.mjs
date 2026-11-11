// mllib.js 的自检（由 selfcheck.mjs 调用）
export default function ({ TS, ML, ok, near, f }) {
  console.log('\n[mllib] 树、森林、GBDT');
  const r = TS.rng(1);
  {
    const X = Array.from({ length: 200 }, (_, i) => [i / 200]), y = X.map(x => (x[0] < 0.37 ? 2 : 7));
    const t = ML.tree(X, y, { maxDepth: 1, maxBins: 250 });
    ok('深度 1 的树还原阶梯函数', near(t.root.thr, 0.37, 0.01) && near(t.predict([0.1]), 2, 1e-9) && near(t.predict([0.9]), 7, 1e-9), 'thr=' + f(t.root.thr));

    const Xs = Array.from({ length: 400 }, () => [r() * 6, r()]), ys = Xs.map(x => Math.sin(x[0]) + 0.1 * r.n());
    const gb = ML.gbdt(Xs, ys, { nTrees: 150, lr: 0.1, maxDepth: 2 });
    const mono = gb.trainLoss.every((v, i) => !i || v <= gb.trainLoss[i - 1] + 1e-12);
    const te = Array.from({ length: 200 }, () => [r() * 6, r()]), err = TS.mean(te.map(x => Math.abs(gb.predict(x) - Math.sin(x[0]))));
    ok('GBDT 训练损失逐轮下降，且学会 sin(x)', mono && err < 0.08, `loss ${f(gb.trainLoss[0])} → ${f(gb.trainLoss[149])}，测试误差 ${f(err)}`);
    ok('特征重要性：有用的特征占绝对多数', gb.importance[0] / (gb.importance[0] + gb.importance[1]) > 0.9);
    ok('predictK(0 棵树) = 均值', near(gb.predictK([1, 1], 0), TS.mean(ys), 1e-9));

    const one = ML.tree(Xs, ys, { maxDepth: 10, minLeaf: 1 }), rf = ML.forest(Xs, ys, { nTrees: 60, maxDepth: 10, minLeaf: 1, featFrac: 1 });
    const e1 = TS.mean(te.map(x => Math.abs(one.predict(x) - Math.sin(x[0])))), e2 = TS.mean(te.map(x => Math.abs(rf.predict(x) - Math.sin(x[0]))));
    ok('随机森林比单棵深树更准（平均降低方差）', e2 < e1, `${f(e1)} → ${f(e2)}`);

    const Xl = Array.from({ length: 300 }, () => [r.n(), r.n()]), yl = Xl.map(x => 1 + 3 * x[0] - 2 * x[1] + 0.01 * r.n()), rg = ML.ridge(Xl, yl, 1e-6);
    ok('岭回归还原线性关系', near(rg.predict([1, 1]), 2, 0.02) && near(rg.predict([0, 0]), 1, 0.02));
  }

  console.log('\n[mllib] 时序特征与预测');
  {
    const ds = TS.data.retail(), cfg = { lags: [1, 7, 14], roll: [7, 28], dow: true, promo: true, holiday: true, log: true };
    const yT = ML.target(ds, cfg), a = ML.featRow(yT, 500, ds, cfg, false), y2 = yT.slice(); y2[500] = 99; y2[501] = 99;
    ok('特征不偷看当天及未来', JSON.stringify(a) === JSON.stringify(ML.featRow(y2, 500, ds, cfg, false)) && a.length === ML.featNames(cfg).length);
    const cut = 976, h = 28, tr = ML.makeXY(ds, cfg, 0, cut), actual = ds.y.slice(cut, cut + h);
    const gb = ML.gbdt(tr.X, tr.y, { nTrees: 150, lr: 0.08, maxDepth: 4, minLeaf: 8 });
    const m1 = TS.metrics(actual, ML.forecast(gb, ds, cfg, cut, h)).mae, m0 = TS.metrics(actual, TS.fc.snaive(ds.y.slice(0, cut), h, 7)).mae;
    ok('GBDT 递归 28 步预测优于季节朴素', m1 < m0, `${f(m1)} < ${f(m0)}`);
    const gi = ML.groupImportance(gb.importance, tr.names);
    ok('重要性按组汇总后和为 1', near(gi.reduce((s, e) => s + e[1], 0), 1, 1e-9), gi.slice(0, 3).map(e => e[0] + ' ' + (e[1] * 100).toFixed(0) + '%').join('，'));

    // 泄漏特征：一步验证看起来极好，真实递归预测反而更差
    const cl = Object.assign({}, cfg, { leak: true }), trl = ML.makeXY(ds, cl, 0, cut, true), gl = ML.gbdt(trl.X, trl.y, { nTrees: 150, lr: 0.08, maxDepth: 4, minLeaf: 8 });
    const peek = TS.metrics(actual, ML.oneStep(gl, ds, cl, cut, cut + h, true)).mae, honest = TS.metrics(actual, ML.forecast(gl, ds, cl, cut, h)).mae;
    const fair = TS.metrics(actual, ML.oneStep(gb, ds, cfg, cut, cut + h, false)).mae;
    ok('泄漏：偷看时误差虚低，真实预测变差', peek < fair && honest > m1, `偷看 ${f(peek)} | 无泄漏一步 ${f(fair)} | 泄漏模型真实预测 ${f(honest)} | 正常模型 ${f(m1)}`);

    // 趋势外推：树模型预测不出训练范围以外的值；预测"相对变化"可以
    const n = 300, tds = { y: Array.from({ length: n }, (_, i) => 100 + 2 * i + 10 * Math.sin(2 * Math.PI * i / 7)), dates: TS.dates('2023-01-01', n) };
    const c0 = { lags: [1, 7], dow: true }, c1 = { lags: [1, 7], dow: true, rel: true }, cutT = 220;
    const fit = c => { const d = ML.makeXY(tds, c, 0, cutT); return ML.forecast(ML.gbdt(d.X, d.y, { nTrees: 120, lr: 0.1, maxDepth: 3, minLeaf: 3 }), tds, c, cutT, 60); };
    const p0 = fit(c0), p1 = fit(c1), maxTrain = Math.max(...tds.y.slice(0, cutT));
    ok('树模型无法外推趋势；改预测相对变化后可以', Math.max(...p0) <= maxTrain + 1e-6 && Math.abs(p1[59] - tds.y[cutT + 59]) < 25, `直接预测末值 ${f(p0[59])}（训练最大值 ${f(maxTrain)}），相对预测末值 ${f(p1[59])}，真实 ${f(tds.y[cutT + 59])}`);
  }
}
