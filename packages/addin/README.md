# 表里有人 WPS 加载项

WPS 表格加载项。它在 WPS 中打开右侧协作面板，自动加入当前打开工作簿对应的协作房间，并显示在线用户、远端选区、冲突和标记导航。

## 现有能力

- 加载插件后自动打开任务窗格；功能区按钮 `协作看板` 可重新打开。
- 首次运行自动打开协作设置窗口。
- 设置窗口保存服务器 socket 地址、表格仓库地址、本地仓库根目录、用户名、用户颜色和高亮开关。
- 用户 ID 保持稳定；改名或换颜色通过 `userUpdate` 同步，不会制造一个假新用户。
- 保存设置后自动加入协作；之后打开 WPS 不再重复弹出设置。
- 自动扫描打开的工作簿，并为每个工作簿维护一个连接/房间。
- 当前激活工作簿决定面板展示的用户、选区和冲突。
- 关闭工作簿或卸载插件时自动离开房间。
- 服务断开后显示重连状态，并每 10 秒自动重连。
- 面板展示当前表格、在线用户、远端选区、冲突、标记导航和运行日志。
- 远端选区、冲突和标记导航支持点击跳转。
- 可选高亮远端选区和冲突单元格；保存前会清理协作高亮。

## 设置项

默认服务器地址：

```txt
ws://127.0.0.1:18080
```

发布机部署时请改成发布机内网 IP，例如：

```txt
ws://192.168.1.20:18080
```

表格仓库地址没有默认值，需要团队自己填写。本地仓库根目录用于把完整文件路径转换成仓库相对路径。

示例：

```txt
本地仓库根目录: D:\GameConfig\table
当前工作簿: D:\GameConfig\table\version\military.xlsx
房间路径: version/military.xlsx
```

房间 ID 由 `表格仓库地址 + 房间路径` 组成，这样不同人把仓库放在不同盘符时仍会进入同一个房间；不同目录下的同名表也不会混在一起。

## 开发

从仓库根目录执行：

```bash
npm run dev:addin
npm run build --workspace @wps-anybody-here/addin
```

WPS 加载项沿用 wpsjs 模板入口结构：

- `index.html`
- `main.js`
- `ribbon.xml`
- `manifest.xml`
- `ui/taskpane.html`
- `js/taskpane.js`
- `js/ribbon.js`

如果修改任务窗格代码，至少验证：

```bash
node --check js/taskpane.js
node node_modules/vite/bin/vite.js build
```

如果修改功能区代码，再验证：

```bash
node --check js/ribbon.js
```

## 发布

从仓库根目录执行：

```bash
npm run publish:addin
```

该命令会先删除旧发布产物：

- `packages/addin/wps-addon-build/`
- `packages/addin/wps-addon-publish/`

随后自动执行 `wpsjs publish`，并选择：

- 服务器地址：`http://127.0.0.1:18080/addin/`
- 发布类型：`在线模式`
- publish 页面多用户使用：`是`

如果服务端使用其他端口，把端口作为参数传入：

```bash
npm run publish:addin -- 18081
```

PowerShell 也可以用环境变量：

```powershell
$env:PORT=18081; npm run publish:addin
```

发布产物由协作服务托管在：

```txt
http://127.0.0.1:18080/addin/
http://127.0.0.1:18080/addin/publish.html
```

## 注意

- 大范围选区不会逐格高亮，会尽量退化成可显示和可跳转的位置。
- 高亮功能依赖 WPS API，不同 WPS 版本的视觉效果可能略有差异。
- WPS 事件目前使用 `SheetSelectionChange`、`SheetChange`、`WorkbookActivate`、`WorkbookOpen`、`NewWorkbook`、`WorkbookBeforeClose` 和 `WorkbookBeforeSave`。
