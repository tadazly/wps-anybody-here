# @wps-anybody-here/server

中心协作服务，提供 WebSocket 房间同步、HTTP Dashboard、健康检查和 WPS 插件发布资源托管。运行状态保存在内存中，服务重启后房间、选区、冲突和贡献统计会清空。

## 启动

从仓库根目录：

```bash
npm install
npm run publish:addin
npm run start
```

只启动服务端 workspace：

```bash
npm run build --workspace @wps-anybody-here/server
npm run start --workspace @wps-anybody-here/server
```

默认端口是 `18080`。可以用环境变量改端口：

```bash
PORT=18081 npm run start
```

PowerShell：

```powershell
$env:PORT=18081; npm run start
```

## HTTP 路由

- `GET /`：Dashboard 页面。
- `GET /dashboard`：Dashboard 页面。
- `GET /api/state`：Dashboard 使用的 JSON 状态。
- `GET /health`：健康检查。
- `GET /install`：WPS 加载项安装页，读取 `wps-addon-publish/publish.html`。
- `GET /addin/*`：发布后的 add-in 构建静态资源。

服务会从这些目录读取 add-in 静态资源：

- `packages/addin/wps-addon-publish/`：仅用于 `/install` 安装页。
- `packages/addin/wps-addon-build/`：用于 `/addin/*` 构建资源。

如果资源不存在，`/install` 和 `/addin/*` 会返回提示：先执行 `npm run publish:addin`。

## Dashboard

默认地址：

```txt
http://127.0.0.1:18080/
```

Dashboard 显示：

- 唯一在线用户数。
- 打开的表格数量。
- 本次服务启动后的总编辑次数。
- 当前冲突数量。
- 每个表格里的用户、心跳、选区和房间统计。
- 全局编辑贡献度。

Dashboard 不展示用户本机绝对路径；表格展示文件名和仓库相对路径。右上角提供 GitHub 和安装插件入口，底部显示版权和刷新时间。

## WebSocket 协议

客户端发：

- `join`：加入房间。
- `userUpdate`：更新用户名或颜色。
- `leave`：离开房间。
- `heartbeat`：心跳。
- `selection`：当前选区。
- `cellChange`：单元格修改。

服务端发：

- `joined`：加入成功后的房间快照。
- `presence`：在线用户列表。
- `userJoined` / `userLeft`：加入和离开提示。
- `selection` / `selectionRemoved`：远端选区变化。
- `cellChange`：远端修改。
- `conflicts`：冲突列表。
- `error`：协议错误。

共享协议类型在 `packages/shared/src/protocol.ts`。

## 房间和冲突

房间 ID 由插件生成，规则是：

```txt
<表格仓库地址>::<仓库相对工作簿路径>
```

冲突 key 优先使用：

```txt
sheetName + rowId + fieldName
```

当客户端没有提供 `rowId` 和 `fieldName` 时，服务端退回：

```txt
sheetName + address
```

同一个冲突 key 下出现多个不同用户的修改，就会进入冲突列表。用户离开房间后，服务端会移除该用户相关的选区和修改记录。

## 验证

```bash
npm run build --workspace @wps-anybody-here/server
```

或在 `packages/server/` 下直接运行：

```bash
node node_modules/typescript/bin/tsc
```
