// 算法自检：node tests/selfcheck.mjs
// 每条检查都是"如果算法写坏了就会失败"的最小断言，不依赖任何测试框架。
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const js = f => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'js', f);
const TS = require(js('tslib.js'));
const ML = existsSync(js('mllib.js')) ? require(js('mllib.js')) : null;
const NN = existsSync(js('nnlib.js')) ? require(js('nnlib.js')) : null;

let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  ✓ ' + name + (info ? '  ' + info : '')); } else { fail++; console.log('  ✗ ' + name + (info ? '  ' + info : '')); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const f = v => (typeof v === 'number' ? v.toFixed(4) : v);

console.log('\n[tslib] 统计与检验');
{
  const r = TS.rng(1), wn = Array.from({ length: 2000 }, () => r.n());
  const ac = TS.acf(wn, 10);
  ok('白噪声 ACF≈0', ac.slice(1).every(v => Math.abs(v) < 0.08), 'max=' + f(Math.max(...ac.slice(1).map(Math.abs))));
  ok('正态分位数', near(TS.normInv(0.975), 1.96, 1e-3) && near(TS.normCdf(1.96), 0.975, 1e-3));
  ok('卡方右尾概率', near(TS.chi2sf(3.841, 1), 0.05, 1e-3) && near(TS.chi2sf(18.307, 10), 0.05, 1e-3));
  const rw = TS.cumsum(wn);
  ok('ADF：白噪声平稳、随机游走不平稳', TS.adf(wn).stationary && !TS.adf(rw).stationary, `wn=${f(TS.adf(wn).stat)} rw=${f(TS.adf(rw).stat)}`);
  ok('Ljung-Box：白噪声 p 不小', TS.ljungBox(wn, 10).p > 0.01, 'p=' + f(TS.ljungBox(wn, 10).p));
  const ar = TS.simArma(3000, [0.7], [], TS.rng(2));
  const pa = TS.pacf(ar, 5);
  ok('AR(1) 的 PACF 一阶截尾', near(pa[1], 0.7, 0.06) && Math.abs(pa[2]) < 0.06 && Math.abs(pa[3]) < 0.06, f(pa[1]) + ' ' + f(pa[2]));
  const fit = TS.ols([[1, 1], [1, 2], [1, 3], [1, 4]], [3, 5, 7, 9]);
  ok('OLS 还原 y=1+2x', near(fit.beta[0], 1, 1e-6) && near(fit.beta[1], 2, 1e-6));
}

console.log('\n[tslib] 分解 / 指数平滑 / ARIMA');
{
  const mo = TS.data.monthly();
  const dc = TS.decompose(mo.y, 12, 'mul');
  ok('乘法分解：季节指数均值为 1、7/8 月最高、2 月最低', near(TS.mean(dc.index), 1, 1e-9) && [6, 7].includes(dc.index.indexOf(Math.max(...dc.index))) && dc.index.indexOf(Math.min(...dc.index)) === 1);
  const tr = mo.y.slice(0, 96), te = mo.y.slice(96);
  const hw0 = TS.ets(tr, { alpha: 0.5, beta: 0.1, gamma: 0.1, trend: true, seasonal: 'mul', m: 12 });
  const hw = TS.etsFit(tr, { trend: true, seasonal: 'mul', m: 12 });
  ok('Holt-Winters 寻优后 SSE 下降', hw.sse < hw0.sse, `${f(hw0.sse)} → ${f(hw.sse)}`);
  const mHW = TS.metrics(te, hw.forecast(24).mean), mSN = TS.metrics(te, TS.fc.snaive(tr, 24, 12));
  ok('Holt-Winters 优于季节朴素（有趋势的数据）', mHW.mae < mSN.mae, `${f(mHW.mae)} < ${f(mSN.mae)}`);

  const a1 = TS.arima(TS.simArma(800, [0.7], [], TS.rng(3)), { p: 1 });
  ok('ARIMA 还原 AR(1) φ=0.7', near(a1.coef.ar[0], 0.7, 0.08), 'φ=' + f(a1.coef.ar[0]));
  const m1 = TS.arima(TS.simArma(800, [], [0.6], TS.rng(4)), { q: 1 });
  ok('ARIMA 还原 MA(1) θ=0.6', near(m1.coef.ma[0], 0.6, 0.08), 'θ=' + f(m1.coef.ma[0]));
  const a2 = TS.arima(TS.simArma(1500, [0.5, -0.3], [0.4], TS.rng(5)), { p: 2, q: 1 });
  ok('ARIMA 还原 ARMA(2,1)', near(a2.coef.ar[0], 0.5, 0.12) && near(a2.coef.ar[1], -0.3, 0.1) && near(a2.coef.ma[0], 0.4, 0.14), [a2.coef.ar[0], a2.coef.ar[1], a2.coef.ma[0]].map(f).join(' '));
  ok('残差像白噪声（Ljung-Box）', TS.ljungBox(a2.resid, 12, 3).p > 0.01);
  const rwFit = TS.arima(TS.cumsum(Array.from({ length: 300 }, (_, i) => TS.rng(6 + i).n())), { d: 1 });
  const fc = rwFit.forecast(10);
  ok('ARIMA(0,1,0) 预测=最后一个值、区间按 √h 变宽', near(fc.mean[9], fc.mean[0], 1e-9) && near(fc.se[3] / fc.se[0], 2, 1e-6));
  const lg = mo.y.map(Math.log), sar = TS.arima(lg.slice(0, 96), { p: 0, d: 1, q: 1, P: 0, D: 1, Q: 1, s: 12 });
  const mSA = TS.metrics(te, sar.forecast(24).mean.map(Math.exp));
  ok('SARIMA(0,1,1)(0,1,1)12 优于季节朴素', mSA.mae < mSN.mae, `${f(mSA.mae)} < ${f(mSN.mae)}`);
  const rt = TS.data.retail().y.map(Math.log);
  const t0 = Date.now(), sr = TS.arima(rt.slice(0, 1000), { p: 1, d: 0, q: 1, P: 0, D: 1, Q: 1, s: 7 });
  ok('日数据 SARIMA 拟合够快（<1.5s）', Date.now() - t0 < 1500 && Number.isFinite(sr.aic), (Date.now() - t0) + 'ms');
}

console.log('\n[tslib] 评估与回测');
{
  const m = TS.metrics([100, 200, 0], [110, 180, 10]);
  ok('指标：已知输入', near(m.mae, 40 / 3, 1e-9) && near(m.wape, 40 / 300, 1e-9) && near(m.mape, 0.1, 1e-9) && near(m.bias, 0, 1e-9));
  ok('pinball：低估惩罚更重', TS.pinball([10], [8], 0.9) > TS.pinball([10], [12], 0.9));
  const y = TS.data.retail().y;
  const bt = TS.backtest(y, (tr, h) => TS.fc.snaive(tr, h, 7), { h: 14, folds: 6, m: 7 });
  ok('回测：6 折、MASE 有限', bt.folds.length === 6 && Number.isFinite(bt.avg.mase) && bt.byH.length === 14, 'MASE=' + f(bt.avg.mase));
}

console.log('\n[tslib] 脏数据注入与清洗');
{
  const ds = TS.data.retail(), m = 7;
  const all = { stockout: 1, shift: 1, spike: 1, neg: 1, flat: 1, tail: 1, miss: 1, block: 1, gap: 1, dup: 1 };
  const dz = TS.dirty(ds, all, 11);
  const al = TS.clean.align(dz.rows, 'last');
  ok('对齐：补全缺失日期、合并重复行', al.y.length === ds.y.length && al.gaps === dz.truth.gapDates.length && al.dup === dz.truth.dupDates.length, `gaps=${al.gaps} dup=${al.dup}`);

  // 只注入缺失：季节填充 < 线性 < 当 0 处理
  const dm = TS.dirty(ds, { miss: 1, block: 1 }, 12), idx = dm.truth.miss.concat(dm.truth.block);
  const err = meth => TS.mean(idx.map(i => Math.abs(TS.clean.impute(dm.y, meth, m)[i] - ds.y[i])));
  ok('填充误差：季节 < 线性 < 当 0', err('seasonal') < err('linear') && err('linear') < err('zero'), ['seasonal', 'linear', 'ffill', 'zero'].map(k => k + '=' + err(k).toFixed(0)).join(' '));

  // 只注入尖峰与负值：残差法检出率高、误报主要是大促
  const dsk = TS.dirty(ds, { spike: 1, neg: 1 }, 13), bad = new Set(dsk.truth.spike.concat(dsk.truth.neg));
  const det = TS.clean.outliers(dsk.y, { method: 'resid', m, thr: 4, log: true });
  const hit = [...bad].filter(i => det.flag[i]).length;
  const fp = det.flag.reduce((c, v, i) => c + (v && !bad.has(i) && !ds.event[i] ? 1 : 0), 0);
  ok('残差法检出注入的异常', hit >= bad.size - 1 && fp <= 12, `命中 ${hit}/${bad.size}，非事件误报 ${fp}`);
  const hp = TS.clean.outliers(dsk.y, { method: 'hampel', thr: 4, log: true });
  ok('Hampel 也能检出大部分', [...bad].filter(i => hp.flag[i]).length >= bad.size - 2);
  const sg = TS.clean.outliers(dsk.y, { method: 'sigma', thr: 3 });
  ok('全局 3σ 漏报更多（没考虑趋势与季节）', [...bad].filter(i => sg.flag[i]).length <= hit);

  const dsh = TS.dirty(ds, { shift: 1 }, 14), cp = TS.clean.changePoint(TS.clean.deseason(dsh.y, m), 56);
  ok('突变点定位', Math.abs(cp.idx - dsh.truth.shift) <= 2 && near(cp.ratio, 0.72, 0.06), `估计 ${cp.idx} / 真实 ${dsh.truth.shift}，比例 ${f(cp.ratio)}`);
  const cp0 = TS.clean.changePoint(TS.clean.deseason(ds.y, m), 56);
  ok('干净数据上突变统计量明显更小', Math.abs(cp0.stat) < 3.5 && Math.abs(cp.stat) > 5, `${f(cp0.stat)} vs ${f(cp.stat)}`);
  const dd = TS.data.dau(), cpd = TS.clean.changePoint(TS.clean.deseason(TS.dirty(dd, { shift: 1 }, 3).y, 7), 56);
  ok('DAU 数据上同样能定位突变', Math.abs(cpd.stat) > 5 && Math.abs(cpd.idx - 304) <= 2 && near(cpd.ratio, 0.72, 0.06), `idx=${cpd.idx} stat=${f(cpd.stat)} ratio=${f(cpd.ratio)}`);

  const dst = TS.dirty(ds, { stockout: 1 }, 15), un = TS.clean.uncensor(dst.y, dst.stock, m), si = dst.truth.stockout;
  const e0 = TS.mean(si.map(i => Math.abs(dst.y[i] - ds.y[i]))), e1 = TS.mean(si.map(i => Math.abs(un[i] - ds.y[i])));
  ok('缺货还原后更接近真实需求', e1 < e0 * 0.35, `${e0.toFixed(0)} → ${e1.toFixed(0)}`);

  const df = TS.dirty(ds, { flat: 1 }, 16), runs = TS.clean.flatline(df.y, 4);
  ok('卡死检测', runs.length === 1 && runs[0][1] - runs[0][0] === 5);
  const hl = TS.clean.health(dz.rows, m);
  ok('体检报告字段齐全', hl.missingDates > 0 && hl.dupRows > 0 && hl.negatives === 3 && hl.changePoint && hl.flatRuns.length >= 1 && hl.tailRatio[2] < 0.5, JSON.stringify({ gaps: hl.missingDates, dup: hl.dupRows, nan: hl.nullValues, out: hl.outliers, cp: hl.changePoint && hl.changePoint.date, tail: hl.tailRatio.map(v => +v.toFixed(2)) }));
  const hc = TS.clean.health(ds.dates.map((d, i) => ({ date: d, value: ds.y[i] })), m);
  ok('干净数据体检：无缺失/重复/突变', hc.missingDates === 0 && hc.dupRows === 0 && !hc.changePoint && hc.flatRuns.length === 0, 'outliers=' + hc.outliers);
}

if (ML) await import('./selfcheck-ml.mjs').then(m => m.default({ TS, ML, ok, near, f }));
if (NN) await import('./selfcheck-nn.mjs').then(m => m.default({ TS, NN, ok, near, f }));

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail ? 1 : 0);
