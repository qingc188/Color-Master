# 忆色 ColorMaster

一个直接在浏览器中运行的颜色记忆游戏。玩家先观察目标色，再通过颜色匹配或颜色复现完成挑战。界面使用由简约色块组成的魔方作为品牌标志，支持手机和桌面浏览器。项目没有后端，运行时不依赖网络资源。

在线地址：[https://qingc188.github.io/Color-Master/](https://qingc188.github.io/Color-Master/)

## 游戏玩法

每道题会先展示目标颜色 5 秒。倒计时结束后，根据所选模式完成匹配或复现。

### 颜色匹配

从一组相近的颜色中找出刚才看到的目标色。

目标色在 Oklch 中生成。干扰色按照 Oklab 感知距离带生成，并在进入色池前检查实际 RGB 是否唯一，因此同一关卡的颜色差异比直接随机修改 HSL 更稳定。

| 难度 | 色池 | 规则 | 记录方式 |
| --- | --- | --- | --- |
| 基础 | 3×3，共 9 个色块 | 完成 10 关，答错也会进入下一关 | 最佳正确数 |
| 进阶 | 4×4，共 16 个色块 | 完成 10 关，干扰色更多 | 最佳正确数 |
| 大师 | 4×4，共 16 个色块 | 无尽模式，答错扣除 1 条生命，3 条生命耗尽后结束 | 最高得分 |

大师难度只有答对后才会进入下一关；答错时会留在当前关卡并重新出题。

### 颜色复现

凭记忆调整颜色参数，尽量还原目标色。

| 难度 | 操作方式 | 实时预览 |
| --- | --- | --- |
| 基础 | HSL 色轮或色相、饱和度、明度滑杆 | 显示 |
| 进阶 | R、G、B 三个滑杆 | 显示 |
| 大师 | R、G、B 三个滑杆 | 不显示 |

每个难度共 10 轮。每轮将目标色和复现色转换到 Oklab，以感知色差和分段评分曲线计分；当有明显颜色的目标被复现成接近灰色时，会增加低饱和度修正。满分 10 分，总分满分 100 分。结果页会用色相、饱和度和明度说明主要偏差；需要了解分数时，可打开得分旁的本轮校色单，查看两块颜色和逐步计算过程。

进入正式挑战后，当前轮次、累计得分和当前难度最佳成绩会整合在复现工作台顶部，并在提交本轮答案后立即更新累计得分。准备界面不显示这组进行中数据。桌面端的基础模式采用色轮与滑杆并排布局，使统计、控制和提交操作能在同一屏工作台中完整显示。

手机竖屏下，色轮与 HSL 滑杆会组成紧凑工作台，当前复现改为横向色条；默认文字大小下无需滚动即可提交答案。所有滑杆均支持触控和方向键微调。

当前评分是第三版标准，在 Oklab 基础色差上增加低饱和度修正，避免明度相近的灰色获得过高分。第三版使用独立的 LocalStorage 记录键，不会把旧版 RGB 距离或第二版 Oklab 成绩误当成新版最佳成绩。

## 其他功能

- 首页魔方是配色开关，点击后以 120° 空间旋转在青橙、星夜紫金和雾蓝柔粉三套界面主题间循环；选择会保存在当前浏览器
- 每个模式、每档难度分别保存最佳成绩
- “我的色卡”保存最近遇到的 100 个不同目标色，并以最近收录优先的色样档案盘展示
- 选择色样后可持续查看 HEX、RGB、HSL 和收录来源；清空记录需要二次确认
- 答题反馈使用浏览器本地生成的短提示音，当前不提供 BGM 或音量图标
- 页面支持触屏操作、手机竖屏和短屏横屏

主题选择、成绩和色彩历史保存在当前浏览器的 LocalStorage 中。更换浏览器、清理站点数据或更换设备后，记录不会自动同步。如果所在 WebView 禁止本地存储，游戏和主题切换仍可正常使用，但本次设置与记录不会保存。

## 项目结构

```text
Color-Master/
├── assets/          品牌图标和界面美术资源
├── index.html       页面结构和游戏界面
├── tailwind.css     预编译的本地 Tailwind 样式
├── styles.css       自定义样式与移动端适配
├── color-utils.js   颜色生成、格式转换和评分
├── app.js           游戏状态与交互逻辑
├── tests/           无依赖的颜色算法回归测试
├── CHANGELOG.md     项目更新记录
└── README.md        项目说明
```

## 本地运行

项目不需要 `npm install`。在项目根目录启动一个静态文件服务器即可：

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

浏览器访问：

```text
http://127.0.0.1:4173/
```

也可以直接打开 `index.html`，但使用本地服务器更接近部署后的访问方式。

修改 HTML 或 JavaScript 中使用的 Tailwind 工具类后，可重新生成本地样式：

```powershell
npx --yes tailwindcss@3.4.17 -c tailwind.config.js -i tailwind-input.css -o tailwind.css --minify
```

## 回归测试

颜色算法测试使用 Node.js 内置测试运行器，不需要安装依赖：

```powershell
node --test tests/color-utils.test.js
```

测试覆盖 Oklab 参考向量、RGB 往返转换、分数换算、得分单调性、色板唯一性和各难度感知距离范围。

Windows 上使用 Node.js 22 或更高版本并安装 Microsoft Edge 后，还可以运行真实浏览器回归：

```powershell
node tests/browser-regression.js
```

浏览器回归会检查基础匹配色板、防重复提交、准备页与进行中统计栏、HSL/RGB 键盘操作、复现反馈与评分说明、存储和音频失败降级、持久化文本安全、手机首屏提交，以及 200% 文字缩放下的滚动和横向溢出。使用其他 Chromium 浏览器时，可通过 `BROWSER_PATH` 指定可执行文件。

小红书小工具离线合规检查：

```powershell
node --test tests/xhs-compliance.test.js
```

浏览器回归会阻断页面的所有 HTTP/HTTPS 请求，确保完整流程只依赖打包在项目中的样式、脚本、SVG 和图片。

## 部署到 GitHub Pages

这个项目是纯静态网页，不需要构建命令。将下面这些文件放在仓库根目录并推送到 `main` 分支：

```text
index.html
tailwind.css
styles.css
color-utils.js
app.js
assets/
README.md
```

然后在 GitHub 仓库中打开 `Settings` → `Pages`，按下面的方式设置：

- Source：`Deploy from a branch`
- Branch：`main`
- Folder：`/(root)`

保存后等待 GitHub 完成发布。仓库名为 `Color-Master` 时，访问地址是：

```text
https://qingc188.github.io/Color-Master/
```

部署到 Netlify、Cloudflare Pages 等静态托管平台时，构建命令留空，发布目录使用项目根目录 `.`。

## 技术说明

- HTML5、CSS3、原生 JavaScript
- Oklab / Oklch 感知颜色生成与评分
- 预编译的本地 Tailwind CSS
- 页面内 SVG 图标符号
- 带异常降级的 LocalStorage 与 Web Audio API、`requestAnimationFrame`

页面样式、图标和品牌图片均为本地资源，可在断网环境运行；短提示音由浏览器本地生成，游戏记录也不会上传到服务器。
