# 当前实现说明

本文只记录当前代码已经实现的结构和行为。早期草案、伪代码和已经被替换的手动加入流程已删除，避免后续维护时误读。

## 模块

```txt
packages/addin/    WPS 表格加载项
packages/server/   WebSocket/HTTP 协作服务
packages/shared/   共享协议类型和工具
scripts/           发布辅助脚本
```

## WPS 加载项

入口：

- `packages/addin/js/ribbon.js`
- `packages/addin/js/taskpane.js`
- `packages/addin/ui/taskpane.html`

功能区行为：

- 插件加载时自动尝试打开 `表里有人` 任务窗格。
- 中文 UI 显示 `表里有人`、`表格协作`、`协作看板`。
- 非中文 UI 显示 `Anybody Here`、`Spreadsheet Collaboration`、`Collaboration Room`。

任务窗格行为：

- 首次运行自动打开协作设置窗口。
- 设置保存到 `localStorage`。
- 保存设置后自动加入协作。
- 后续打开 WPS 不再自动弹出设置。
- 用户可以从面板右上角手动重新打开设置。
- 面板没有手动加入/离开按钮。

设置项：

- 服务器 socket 地址，默认 `ws://127.0.0.1:18080`。
- 表格仓库地址，无默认值。
- 本地仓库根目录，无默认值。
- 用户名，无默认值。
- 用户颜色，支持自动分配和自定义。
- 是否高亮远端选取单元格，默认开启。

身份：

- 用户 ID 保存在本地，保持稳定。
- 修改用户名或颜色时发送 `userUpdate`。
- 服务端和其他客户端会更新显示信息，不会把改名当成新用户加入。

多工作簿：

- 插件扫描当前 WPS 打开的工作簿。
- 每个打开的工作簿维护一个 WebSocket 房间连接。
- 当前激活工作簿决定面板展示内容。
- 工作簿关闭时发送 `leave` 并关闭对应连接。
- 插件卸载或页面 unload 时离开所有房间。

房间 ID：

```txt
<表格仓库地址>::<仓库相对工作簿路径>
```

当无法从本地仓库根目录计算相对路径时，插件会谨慎退回到规范化路径。面板只直接显示当前工作簿文件名，完整路径仅作为本机 tooltip 使用。

同步内容：

- 心跳。
- 在线用户。
- 当前选区。
- 单元格修改。
- 冲突列表。

视觉提示：

- 面板显示当前表格、在线用户、远端选区、冲突、标记导航和运行日志。
- 远端选区、冲突和标记导航可以点击跳转。
- 高亮开启时，插件会在表格中标记远端选区和冲突。
- 保存工作簿前会先清理协作高亮，尽量避免把协作标记保存进文件。
- 服务断开后显示发布机下线，并按 10 秒倒计时自动重连。

## 服务端

入口：

- `packages/server/src/index.ts`
- `packages/server/src/room-manager.ts`
- `packages/server/src/dashboard.ts`

HTTP：

- `/` 和 `/dashboard` 返回 Dashboard。
- `/api/state` 返回 Dashboard JSON 状态。
- `/health` 返回健康检查。
- `/addin/` 和 `/addin/*` 托管 WPS 加载项构建资源。

WebSocket：

- 使用 `ws`。
- 每个 WebSocket 连接对应一个房间里的一个客户端。
- 服务端定期清理心跳超时客户端。
- 房间、选区、修改记录、冲突和贡献统计都保存在内存中。

Dashboard：

- 显示唯一在线用户数，而不是连接数。
- 显示打开的表格、用户、心跳、选区、编辑次数和冲突数量。
- 显示全局编辑贡献度。
- 不展示用户本机绝对路径。
- 右上角提供 GitHub 和安装插件按钮。
- 底部居中显示 `Copyright © 2026 Tadazly.` 和刷新时间。

## 协议

共享类型在：

```txt
packages/shared/src/protocol.ts
```

客户端消息：

- `join`
- `userUpdate`
- `leave`
- `heartbeat`
- `selection`
- `cellChange`

服务端消息：

- `joined`
- `presence`
- `userJoined`
- `userLeft`
- `selection`
- `selectionRemoved`
- `cellChange`
- `conflicts`
- `error`

## 冲突规则

服务端记录每个冲突 key 下最近的修改。只要同一个 key 下出现多个用户的修改，就生成冲突。

key 优先使用：

```txt
sheetName + rowId + fieldName
```

如果客户端没有提供 `rowId` 和 `fieldName`，退回：

```txt
sheetName + address
```

这样普通表格仍可按地址检测冲突；能识别稳定行 ID 的配置表则可按业务字段定位。

## 发布流程

发布插件：

```bash
npm run publish:addin
```

启动服务：

```bash
npm run start
```

默认服务地址：

```txt
http://127.0.0.1:18080/
http://127.0.0.1:18080/addin/
ws://127.0.0.1:18080
```

如果端口不是 `18080`，发布插件和启动服务必须使用同一个端口。

## 验证

服务端：

```bash
node node_modules/typescript/bin/tsc
```

插件任务窗格：

```bash
node --check js/taskpane.js
node node_modules/vite/bin/vite.js build
```

插件功能区：

```bash
node --check js/ribbon.js
```
