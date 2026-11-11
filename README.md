# 时间序列实验室（time-series-lab）

一个可以动手玩的中文时间序列教程网站：从基础概念、脏数据清洗、指数平滑、ARIMA，到机器学习（GBDT）和深度学习（LSTM、Transformer）。每个概念都配有互动实验，**所有模型都在浏览器里现场计算**，电脑和手机都能打开。

在线地址：<https://patience-star.github.io/time-series-lab/>

## 内容

| 章 | 主题 |
|---|---|
| 01 | 认识时间序列 |
| 02 | 探索分析与分解 |
| 03 | 脏数据诊断与清洗 |
| 04 | 平稳性、差分与自相关 |
| 05 | 预测基线与评估 |
| 06 | 指数平滑 |
| 07 | ARIMA 家族 |
| 08 | 机器学习预测 |
| 09 | 神经网络基础 |
| 10 | LSTM |
| 11 | 注意力与 Transformer |
| 12 | 业务实战与模型竞技场 |
| 13 | 速查手册 |

## 项目结构

```
index.html                 首页（学习路线、进度）
chapters/NN-xxx.html       一章一个文件：正文 + 本章的互动脚本都在里面
assets/css/style.css       全站唯一样式表（响应式、深浅色）
assets/js/site.js          章节清单 + 顶栏/侧栏/上下章 + 互动实验框架 + 小组件
assets/js/tslib.js         时序算法库：仿真数据、ACF/PACF、分解、指数平滑、SARIMA、评估回测、脏数据注入与清洗
assets/js/mllib.js         机器学习库：特征构造、岭回归、回归树、随机森林、GBDT
assets/js/nnlib.js         神经网络库：MLP、RNN、LSTM、Adam、梯度检查
assets/vendor/             第三方库（ECharts、KaTeX），已打包进仓库，不依赖 CDN
tests/selfcheck.mjs        算法自检
```

纯静态网站：没有构建步骤、没有框架、没有后端。改完文件，推送到 GitHub 就生效。

## 本地预览

直接双击 `index.html` 即可。或者起一个本地服务器：

```bash
python -m http.server 8765
```

然后打开 <http://localhost:8765>。

## 常见修改

### 新增一章

1. 复制 `chapters/` 下任意一章，改文件名（如 `14-xxx.html`），把 `<body data-ch="14">` 里的编号改掉，替换正文。
2. 在 `assets/js/site.js` 顶部的 `CHAPTERS` 数组里加一行。

顶栏、侧栏目录、上一章/下一章、首页卡片、学习进度都会自动更新。调整章节顺序也只需要改 `CHAPTERS` 里的顺序。

### 加一个互动实验

HTML 里放一个容器：

```html
<div class="demo" id="my-demo">
  <div class="demo-title">🧪 实验标题</div>
  <div class="demo-body">
    <div class="ctl"></div>        <!-- 控件自动生成在这里 -->
    <div class="chart"></div>      <!-- 图表；可以放多个 -->
    <div class="readout"></div>    <!-- 指标卡、表格等文字输出 -->
  </div>
</div>
```

页面底部的脚本里注册它：

```js
Site.demo('my-demo', {
  controls: [
    { k: 'alpha', label: '平滑系数', min: 0, max: 1, step: 0.05, value: 0.3 },                 // 滑块
    { k: 'mode', label: '模式', type: 'seg', options: [['add', '加法'], ['mul', '乘法']] },   // 分段按钮
    { k: 'log', label: '取对数', type: 'check', value: false },                                // 复选框
    { act: 'regen', label: '重新生成', run: s => { s.seed = (s.seed || 1) + 1; } },           // 按钮
  ],
  render(s, d) {                       // 任何控件变化都会调用；s 是当前各控件的取值
    const y = TS.data.retail().y.slice(-120);
    d.chart(0, { xAxis: { data: y.map((_, i) => i) }, yAxis: {}, series: [Site.S.line('销量', y, { c: 0 })] });
    d.out(Site.tiles([['均值', TS.mean(y)]]));
  },
});
```

配色、坐标轴、提示框、深浅色切换、手机适配都由 `site.js` 统一处理。

### 改样式

只动 `assets/css/style.css`。颜色都是文件开头的 CSS 变量，浅色、深色各一组。

### 改算法

改对应的库文件，然后运行自检（见下）。

**注意**：正文里不要写死由数据算出来的数字（比如"误差下降了 23%"）。页面上的数字全部是现场计算的；仿真数据的生成器一改，写死的数字就会对不上。

## 自检

算法自检（需要 Node.js）：

```bash
node tests/selfcheck.mjs
```

它会检查：ARIMA 能否还原模拟数据的系数、清洗流水线能否找回注入的脏数据、GBDT 损失是否逐轮下降、MLP/RNN/LSTM 反向传播的梯度是否与数值梯度一致，等等。

页面自检：在任意一章的浏览器控制台里运行

```js
Site.selfTest()
```

它会把这一页每个实验的每个控件拨一遍、每个按钮点一次，并报告出错的实验。

## 发布更新

```bash
git add -A
git commit -m "说明改了什么"
git push
```

推送后 GitHub Pages 会在一两分钟内自动更新（仓库 Settings → Pages 中，Source 选 "Deploy from a branch"，分支 `main`，目录 `/ (root)`）。

## 说明

- 页面里的业务数据都是按真实规律**仿真生成**的（固定随机种子），所以清洗和预测效果可以与真值对比。
- 页面内的算法是为教学手写的精简实现（例如 ARIMA 用条件平方和估计而非精确极大似然）。生产环境请使用各章给出的 Python 库。
- 第三方库：Apache ECharts（Apache-2.0）、KaTeX（MIT），许可证见 `assets/vendor/`。
