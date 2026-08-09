# 忆色 ColorMaster

一个直接在浏览器中运行的颜色记忆游戏。玩家先观察目标色，再通过颜色匹配或颜色复现完成挑战。界面使用由简约色块组成的魔方作为品牌标志，支持手机和桌面浏览器。项目没有后端，也不需要安装依赖和执行构建。

在线地址：[https://qingc188.github.io/Color-Master/](https://qingc188.github.io/Color-Master/)

## 游戏玩法

每道题会先展示目标颜色 6 秒。倒计时结束后，根据所选模式完成匹配或复现。

### 颜色匹配

从一组相近的颜色中找出刚才看到的目标色。

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
| 基础 | HSL 色轮和明度滑杆 | 显示 |
| 进阶 | R、G、B 三个滑杆 | 显示 |
| 大师 | R、G、B 三个滑杆 | 不显示 |

每个难度共 10 轮。每轮按目标色与复现色的 RGB 距离计分，满分 10 分，总分满分 100 分。

## 其他功能

- 每个模式、每档难度分别保存最佳成绩
- 保存最近遇到的 50 个不同目标色，可查看 HEX、RGB 和 HSL 数值
- 可随时清空色彩历史
- 音效开关会保留到下次访问
- 页面支持触屏操作、手机竖屏和短屏横屏

成绩、色彩历史和音效设置都保存在当前浏览器的 LocalStorage 中。更换浏览器、清理站点数据或更换设备后，记录不会自动同步。

## 项目结构

```text
Color-Master/
├── assets/          品牌图标和界面美术资源
├── index.html       页面结构和游戏界面
├── styles.css       自定义样式与移动端适配
├── color-utils.js   颜色生成、格式转换和评分
├── app.js           游戏状态与交互逻辑
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

## 部署到 GitHub Pages

这个项目是纯静态网页，不需要构建命令。将下面这些文件放在仓库根目录并推送到 `main` 分支：

```text
index.html
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
- Tailwind CSS CDN
- Font Awesome 4.7
- LocalStorage、Web Audio API、`requestAnimationFrame`

页面样式和图标使用了网络资源。离线打开或网络受限时，CDN 无法加载会影响页面样式和图标；提示音由浏览器本地生成，游戏记录也不会上传到服务器。
