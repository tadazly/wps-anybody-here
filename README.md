# 表里有人

> 看看表里谁在配，谁在改，谁在和你撞格子

`表里有人` 是一个 WPS 表格协作提醒插件，配套一个轻量 WebSocket/HTTP 协作服务。它不替代 WPS 云协作，而是帮助团队在同一个 Git 表格仓库里编辑本地配置表时，看见“谁也在这张表里、谁正在看哪里、哪里可能撞格子”。

## 现有能力

- WPS 加载插件后会自动打开右侧协作面板。
- 首次使用自动弹出设置窗口；保存后再次打开 WPS 不再重复弹窗。
- 设置项包括服务器 socket 地址、表格仓库地址、本地仓库根目录、用户名、用户颜色和是否高亮远端单元格。
- 用户 ID 稳定保存在 `localStorage`，改名或换颜色不会被当成新用户。
- 保存设置后自动加入协作；打开、关闭、切换工作簿时自动维护对应房间。
- 一个 WPS 实例可以同时为多个打开的工作簿保持协作连接，面板显示当前激活工作簿的状态。
- 房间 ID 使用 `表格仓库地址 + 仓库相对路径`，避免暴露本机绝对路径，也能区分不同目录下的同名表。
- 面板显示当前表格、在线用户、远端选区、冲突、标记导航和运行日志。
- 远端选区和冲突可以点击跳转到对应单元格。
- 可选高亮远端选区和冲突单元格；保存工作簿前会先清理协作高亮，减少污染原表格样式。
- 服务断开后显示发布机下线状态，并按 10 秒倒计时自动重连。
- 服务端 Dashboard 显示唯一在线用户数、打开表格、每张表的用户、编辑贡献度和冲突数量。
- Dashboard 右上角提供 GitHub 跳转和“安装插件”入口，底部显示版权和刷新时间。
- 服务端托管 WPS 插件安装页和静态资源，默认路径是 `/install` 和 `/addin/`。

## 目录

- `packages/addin/`：WPS 表格加载项。
- `packages/server/`：WebSocket/HTTP 协作服务。
- `packages/shared/`：插件和服务端共享的协议类型、颜色和工具。
- `docs/implementation.md`：当前实现说明。
- `docs/DECISIONS.md`：关键产品和技术决策。
- `scripts/`：发布辅助脚本。

## 发布机部署

在发布机上执行：

```bash
npm install
npm run publish:addin
npm run build
npm run start
```

默认地址：

```txt
Dashboard: http://127.0.0.1:18080/
插件安装页: http://127.0.0.1:18080/install
插件静态资源: http://127.0.0.1:18080/addin/
WebSocket: ws://127.0.0.1:18080
健康检查: http://127.0.0.1:18080/health
```

给其他电脑使用时，发布插件要传入其他电脑也能访问的 HTTP 地址。没有写路径时脚本会自动补成 `/addin/`：

```bash
npm run publish:addin -- --url http://splan.61.com
npm run publish:addin -- --url http://192.168.1.20:18080
```

如果发布机使用其他端口，发布插件和启动服务要使用同一个端口：

```bash
npm run publish:addin -- --url http://192.168.1.20:18081
PORT=18081 npm run start
```

PowerShell：

```powershell
npm run publish:addin -- --url http://192.168.1.20:18081
$env:PORT=18081; npm run start
```

给其他电脑使用时，把插件设置里的服务器地址改成发布机内网 IP，例如：

```txt
ws://192.168.1.20:18080
```

## 用户使用

1. 打开 WPS 表格。
2. 插件会自动打开右侧 `表里有人` 面板；也可以在功能区点击 `协作看板` 重新打开。
3. 首次使用填写服务器地址、表格仓库地址、本地仓库根目录和用户名。
4. 选择自动分配颜色或自定义颜色。
5. 保存后插件会自动加入当前表格协作房间。

表格仓库地址没有项目默认值，需要团队自己填写。本地仓库根目录用于把每个人电脑上的绝对路径转换成一致的仓库相对路径。

示例：

```txt
本地仓库根目录: D:\GameConfig\table
当前工作簿: D:\GameConfig\table\version\military.xlsx
房间路径: version/military.xlsx
```

## Dashboard

Dashboard 地址默认是：

```txt
http://127.0.0.1:18080/
```

它用于发布机或团队维护者查看当前协作状态：

- 当前唯一在线用户数。
- 当前打开的表格数量。
- 本次服务启动后的编辑次数。
- 当前冲突数量。
- 每个表格里的用户、心跳和选区。
- 全局编辑贡献度。

Dashboard 不展示用户本机绝对路径；表格优先显示文件名和仓库相对路径。

## 协作和冲突规则

服务端按房间保存运行时状态。重启服务后，在线房间、选区、冲突和贡献统计都会清空。

冲突 key 优先使用：

```txt
sheetName + rowId + fieldName
```

当插件无法从表格里识别稳定行 ID 和字段名时，退回：

```txt
sheetName + address
```

这意味着普通表格仍能按单元格地址检测冲突；带稳定 ID 的配置表则可以在排序、插行后更准确地定位同一条数据。

## 开发

常用命令：

```bash
npm run dev:server
npm run dev:addin
npm run build
npm run typecheck
```

服务端单独验证：

```bash
npm run build --workspace @wps-anybody-here/server
```

插件单独验证：

```bash
npm run build --workspace @wps-anybody-here/addin
```

如果 Codex shell 里 `node` 或 `npm` 不在 PATH，先使用 Codex 桌面提供的运行时路径。
