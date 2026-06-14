# @wps-anybody-here/server

中心协作服务，负责房间、在线用户、选区广播和地址级冲突检测。第一版状态只保存在内存里，重启后房间和冲突记录会清空。

## 启动

```bash
npm install
npm run build --workspace @wps-anybody-here/server
npm run start --workspace @wps-anybody-here/server
```

默认端口是 `18080`。可以用环境变量改端口：

```bash
PORT=18080 npm run start --workspace @wps-anybody-here/server
```

健康检查：

```txt
http://127.0.0.1:18080/health
```

发布机看板：

```txt
http://127.0.0.1:18080/
```

看板会显示：

- 当前在线用户。
- 当前打开了哪些表格，以及每张表有哪些人在使用。表格路径优先显示仓库相对路径，不展示用户本机完整路径。
- 本次服务启动后的编辑贡献度，按 `cellChange` 次数统计。
- 当前地址级冲突数量。

WebSocket 地址：

```txt
ws://127.0.0.1:18080
```

## 协议

客户端发：

- `join`：加入房间。
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
- `conflicts`：地址级冲突列表。

HTTP 接口：

- `GET /`：发布机看板页面。
- `GET /api/state`：看板使用的 JSON 状态。
- `GET /health`：健康检查。

## 冲突规则

当前使用：

```txt
sheetName + address
```

也就是不同用户都修改了同一个地址时，例如 `Sheet1!B20`，服务端会把它加入冲突列表。后续正式版建议升级到：

```txt
sheetName + rowId + fieldName
```
