# wps-anybody-here 实现说明

## 1. 项目目标

`wps-anybody-here` 是一个用于 WPS 表格的轻量协作提示插件，目标不是替代 WPS 云协作，而是解决本地游戏配置表仓库中的多人改表冲突问题。

项目核心能力：

1. 多人打开同一张表时，实时显示当前房间内有哪些人。
2. 其他人加入房间时，顶部弹出提示：`XXX 加入了房间`。
3. 其他人关闭表格或断开连接时，顶部弹出提示：`XXX 离开了房间`。
4. 显示远端用户当前选中的单元格。
5. 使用用户固定颜色高亮远端选区。
6. 当不同用户编辑了同一个单元格时，将该单元格标红。
7. 右侧任务窗格中显示在线用户、远端选区、冲突列表、迷你标记条。
8. 中心服务器未运行或意外关闭时，顶部灰色显示：`发布机已下线`。
9. 插件每 10 秒自动尝试重连服务器。
10. 服务器恢复后，插件自动重新加入当前表格房间。

第一阶段使用 `sheetName + address` 判断冲突。后续正式版应升级为 `sheetName + id + field`，避免排序、插行后地址变化导致冲突判断错误。

---

## 2. 推荐项目结构

```txt
wps-anybody-here/
├─ server/
│  ├─ package.json
│  ├─ tsconfig.json
│  └─ src/
│     ├─ index.ts
│     ├─ types.ts
│     ├─ room-manager.ts
│     └─ protocol.ts
│
├─ addin/
│  ├─ package.json
│  ├─ src/
│  │  ├─ taskpane.html
│  │  ├─ taskpane.ts
│  │  ├─ style.css
│  │  ├─ wps-api.ts
│  │  ├─ collab-client.ts
│  │  ├─ user.ts
│  │  └─ color.ts
│  └─ 由 wpsjs 创建的其他配置文件
│
└─ README.md
```

如果 Codex 直接生成项目，建议先实现 `server` 和 `addin/src` 的核心逻辑；WPS 加载项模板相关文件可以用 `wpsjs create` 生成后再接入。

---

## 3. 总体架构

```txt
WPS 插件任务窗格
    ├─ 获取当前工作簿信息
    ├─ 获取或生成用户身份
    ├─ 连接 WebSocket 服务器
    ├─ 加入当前工作簿对应的 room
    ├─ 监听选区变化
    ├─ 监听单元格修改
    ├─ 渲染在线用户、远端选区、冲突列表
    ├─ 高亮远端选区和冲突单元格
    └─ 断线后每 10 秒自动重连

中心服务器
    ├─ WebSocket 服务
    ├─ room 管理
    ├─ 在线用户管理
    ├─ 选区广播
    ├─ 单元格修改记录
    ├─ 冲突检测
    ├─ 用户加入/离开广播
    └─ 心跳超时清理
```

---

## 4. 关键概念

### 4.1 Room

同一张表格对应同一个房间。

第一版可以使用完整文件路径作为 `roomId`：

```ts
function makeRoomId(fullName: string) {
    return fullName.replace(/\\/g, "/").toLowerCase();
}
```

正式版建议改成：

```txt
Git 仓库 ID + 表格相对路径
```

例如：

```txt
project-xls-repo::config/item.xlsx
```

不要长期依赖绝对路径，因为不同用户本地仓库路径可能不同。

---

### 4.2 用户身份

用户身份需要稳定，颜色也需要固定。

推荐用户信息结构：

```ts
interface CollabUser {
    userId: string;
    userName: string;
    source: "project" | "wps-operator" | "wps-username" | "local-agent" | "manual";
    color: string;
    bgColor: string;
    borderColor: string;
}
```

获取优先级：

```txt
1. 公司/项目账号
2. WPS 登录操作者信息
3. 本地 Agent 返回的电脑用户名
4. WPS Application.UserName
5. 手动输入，并保存到 localStorage
```

第一版可以直接使用手动输入 + localStorage。

---

### 4.3 用户固定颜色

使用 `userId` 作为种子生成固定颜色，不要每次随机。

```ts
const USER_COLORS = [
    "#4E7FFF",
    "#16A34A",
    "#F59E0B",
    "#8B5CF6",
    "#06B6D4",
    "#EC4899",
    "#84CC16",
    "#F97316",
    "#6366F1",
    "#14B8A6",
];

function hashString(str: string): number {
    let hash = 2166136261;

    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
}

function colorFromSeed(seed: string): string {
    const hash = hashString(seed);
    return USER_COLORS[hash % USER_COLORS.length];
}
```

---

## 5. WebSocket 协议

### 5.1 客户端发送给服务端

```ts
type ClientMsg =
    | JoinMsg
    | LeaveMsg
    | HeartbeatMsg
    | SelectionMsg
    | CellChangeMsg;
```

#### join

```ts
interface JoinMsg {
    type: "join";
    roomId: string;
    userId: string;
    userName: string;
    color: string;
    workbookName: string;
}
```

#### leave

```ts
interface LeaveMsg {
    type: "leave";
}
```

#### heartbeat

```ts
interface HeartbeatMsg {
    type: "heartbeat";
}
```

#### selection

```ts
interface SelectionMsg {
    type: "selection";
    sheetName: string;
    address: string;
    row?: number;
    col?: number;
}
```

#### cellChange

```ts
interface CellChangeMsg {
    type: "cellChange";
    sheetName: string;
    address: string;
    oldValue?: unknown;
    newValue: unknown;
}
```

---

### 5.2 服务端发送给客户端

```ts
type ServerMsg =
    | JoinedServerMsg
    | PresenceServerMsg
    | UserJoinedServerMsg
    | UserLeftServerMsg
    | SelectionServerMsg
    | SelectionRemovedServerMsg
    | CellChangeServerMsg
    | ConflictsServerMsg
    | ErrorServerMsg;
```

#### joined

客户端成功加入房间后，服务端返回当前房间快照。

```ts
interface JoinedServerMsg {
    type: "joined";
    roomId: string;
    users: UserInfo[];
    selections: SelectionInfo[];
    conflicts: ConflictInfo[];
}
```

#### presence

在线用户列表更新。

```ts
interface PresenceServerMsg {
    type: "presence";
    users: UserInfo[];
}
```

#### userJoined

其他用户加入房间。

```ts
interface UserJoinedServerMsg {
    type: "userJoined";
    user: UserInfo;
}
```

#### userLeft

其他用户离开房间。

```ts
interface UserLeftServerMsg {
    type: "userLeft";
    user: UserInfo;
}
```

#### selection

远端用户选区变化。

```ts
interface SelectionServerMsg {
    type: "selection";
    selection: SelectionInfo;
}
```

#### selectionRemoved

远端用户离开或断开后，清理他的选区。

```ts
interface SelectionRemovedServerMsg {
    type: "selectionRemoved";
    userId: string;
}
```

#### cellChange

远端用户修改了单元格。

```ts
interface CellChangeServerMsg {
    type: "cellChange";
    change: ChangeInfo;
}
```

#### conflicts

冲突列表更新。

```ts
interface ConflictsServerMsg {
    type: "conflicts";
    conflicts: ConflictInfo[];
}
```

#### error

```ts
interface ErrorServerMsg {
    type: "error";
    message: string;
}
```

---

### 5.3 公共数据结构

```ts
interface UserInfo {
    userId: string;
    userName: string;
    color: string;
    workbookName: string;
    lastHeartbeatAt?: number;
}

interface SelectionInfo {
    userId: string;
    userName: string;
    color: string;
    sheetName: string;
    address: string;
    updatedAt: number;
}

interface ChangeInfo {
    userId: string;
    userName: string;
    color: string;
    sheetName: string;
    address: string;
    oldValue?: unknown;
    newValue: unknown;
    updatedAt: number;
}

interface ConflictInfo {
    key: string;
    sheetName: string;
    address: string;
    users: Array<{
        userId: string;
        userName: string;
        color: string;
        newValue: unknown;
    }>;
}
```

---

## 6. 服务端实现关键点

### 6.1 依赖

```bash
cd server
npm init -y
npm i ws
npm i -D typescript ts-node-dev @types/node @types/ws
```

推荐 `package.json`：

```json
{
  "name": "wps-anybody-here-server",
  "version": "0.1.0",
  "type": "commonjs",
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "build": "tsc"
  },
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.12",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.5.0"
  }
}
```

---

### 6.2 服务端状态结构

```ts
interface ClientInfo {
    ws: WebSocket;
    roomId: string;
    userId: string;
    userName: string;
    color: string;
    workbookName: string;
    lastHeartbeatAt: number;
}

interface Room {
    roomId: string;
    clients: Map<string, ClientInfo>;
    selections: Map<string, SelectionInfo>;
    changes: Map<string, ChangeInfo[]>;
}

const rooms = new Map<string, Room>();
const clientMap = new Map<WebSocket, ClientInfo>();
```

---

### 6.3 join 逻辑

服务端收到 `join` 后：

1. 创建或获取 room。
2. 将用户加入 room。
3. 给当前连接发送 `joined` 快照。
4. 给其他用户广播 `userJoined`。
5. 给所有用户广播 `presence`。

注意：如果同一个 `userId` 重复加入，避免重复弹出加入提示。

```ts
function handleJoin(ws: WebSocket, msg: JoinMsg) {
    const room = getRoom(msg.roomId);
    const existed = room.clients.has(msg.userId);

    const client: ClientInfo = {
        ws,
        roomId: msg.roomId,
        userId: msg.userId,
        userName: msg.userName,
        color: msg.color,
        workbookName: msg.workbookName,
        lastHeartbeatAt: Date.now(),
    };

    clientMap.set(ws, client);
    room.clients.set(msg.userId, client);

    send(ws, {
        type: "joined",
        roomId: room.roomId,
        users: buildPresence(room),
        selections: Array.from(room.selections.values()),
        conflicts: detectConflicts(room),
    });

    if (!existed) {
        broadcast(room, {
            type: "userJoined",
            user: {
                userId: client.userId,
                userName: client.userName,
                color: client.color,
                workbookName: client.workbookName,
            },
        }, client.userId);
    }

    broadcast(room, {
        type: "presence",
        users: buildPresence(room),
    });
}
```

---

### 6.4 leave / close / heartbeat 超时

用户主动发送 `leave`、WebSocket 关闭、连接报错、心跳超时，都调用统一清理函数。

```ts
function cleanupClient(ws: WebSocket) {
    const client = clientMap.get(ws);
    if (!client) {
        return;
    }

    clientMap.delete(ws);

    const room = rooms.get(client.roomId);
    if (!room) {
        return;
    }

    room.clients.delete(client.userId);
    room.selections.delete(client.userId);

    broadcast(room, {
        type: "userLeft",
        user: {
            userId: client.userId,
            userName: client.userName,
            color: client.color,
            workbookName: client.workbookName,
        },
    }, client.userId);

    broadcast(room, {
        type: "presence",
        users: buildPresence(room),
    });

    broadcast(room, {
        type: "selectionRemoved",
        userId: client.userId,
    });

    if (room.clients.size === 0) {
        rooms.delete(room.roomId);
    }
}
```

心跳超时：

```ts
setInterval(() => {
    const now = Date.now();

    for (const client of Array.from(clientMap.values())) {
        if (now - client.lastHeartbeatAt > 30_000) {
            cleanupClient(client.ws);

            try {
                client.ws.close();
            } catch {
                // ignore
            }
        }
    }
}, 5_000);
```

第一版建议：

```txt
客户端心跳间隔：5 秒
服务端离线超时：30 秒
```

想更快显示离开，可以改成：

```txt
客户端心跳间隔：3 秒
服务端离线超时：15 秒
```

---

### 6.5 选区同步

```ts
function handleSelection(client: ClientInfo, msg: SelectionMsg) {
    const room = getRoom(client.roomId);

    const selection: SelectionInfo = {
        userId: client.userId,
        userName: client.userName,
        color: client.color,
        sheetName: msg.sheetName,
        address: msg.address,
        updatedAt: Date.now(),
    };

    room.selections.set(client.userId, selection);

    broadcast(room, {
        type: "selection",
        selection,
    }, client.userId);
}
```

---

### 6.6 单元格修改和冲突检测

第一版使用：

```ts
function makeCellKey(sheetName: string, address: string) {
    return `${sheetName}::${address}`;
}
```

修改记录：

```ts
function handleCellChange(client: ClientInfo, msg: CellChangeMsg) {
    const room = getRoom(client.roomId);
    const key = makeCellKey(msg.sheetName, msg.address);

    const change: ChangeInfo = {
        userId: client.userId,
        userName: client.userName,
        color: client.color,
        sheetName: msg.sheetName,
        address: msg.address,
        oldValue: msg.oldValue,
        newValue: msg.newValue,
        updatedAt: Date.now(),
    };

    const list = room.changes.get(key) || [];
    list.push(change);
    room.changes.set(key, list);

    broadcast(room, {
        type: "cellChange",
        change,
    }, client.userId);

    broadcast(room, {
        type: "conflicts",
        conflicts: detectConflicts(room),
    });
}
```

冲突检测：

```ts
function detectConflicts(room: Room): ConflictInfo[] {
    const conflicts: ConflictInfo[] = [];

    for (const [key, list] of room.changes.entries()) {
        const userIds = new Set(list.map(item => item.userId));
        if (userIds.size <= 1) {
            continue;
        }

        const latestByUser = new Map<string, ChangeInfo>();
        for (const item of list) {
            latestByUser.set(item.userId, item);
        }

        const first = list[0];

        conflicts.push({
            key,
            sheetName: first.sheetName,
            address: first.address,
            users: Array.from(latestByUser.values()).map(item => ({
                userId: item.userId,
                userName: item.userName,
                color: item.color,
                newValue: item.newValue,
            })),
        });
    }

    return conflicts;
}
```

---

## 7. WPS 插件实现关键点

### 7.1 页面结构

任务窗格页面建议包含：

```html
<body>
    <div id="toastRoot" class="toast-root"></div>

    <div class="panel">
        <div id="serverStatusBar" class="server-status offline">
            <span id="serverStatusDot" class="server-status-dot"></span>
            <span id="serverStatusText">发布机已下线</span>
            <button id="reconnectBtn" class="reconnect-btn">重连</button>
        </div>

        <div class="header">
            <div class="title">wps-anybody-here</div>
            <button id="joinBtn">加入协作</button>
        </div>

        <div class="section">
            <div class="section-title">当前表格</div>
            <div id="workbookName" class="muted">未加入</div>
        </div>

        <div class="section">
            <div class="section-title">在线用户</div>
            <div id="userList"></div>
        </div>

        <div class="section">
            <div class="section-title">远端选区</div>
            <div id="selectionList"></div>
        </div>

        <div class="section">
            <div class="section-title conflict-title">冲突</div>
            <div id="conflictList"></div>
        </div>

        <div class="section">
            <div class="section-title">标记导航</div>
            <div id="miniMap" class="mini-map"></div>
        </div>
    </div>

    <script src="./taskpane.js"></script>
</body>
```

---

### 7.2 顶部服务器状态条

状态：

```ts
type ServerStatus = "connected" | "connecting" | "reconnecting" | "offline";
```

文案：

```txt
connected:    协作服务已连接
connecting:   正在连接发布机...
reconnecting: 发布机已下线，正在尝试重新连接...
offline:      发布机已下线
```

断线时要求：

```txt
顶部灰色显示：发布机已下线，10s 后重试连接
每 10 秒尝试重新连接服务器
```

---

### 7.3 WebSocket 重连状态机

核心变量：

```ts
const WS_URL = "ws://127.0.0.1:18080";

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let reconnectCountdownTimer: number | null = null;
let heartbeatTimer: number | null = null;

let joined = false;
let manuallyClosed = false;

const RECONNECT_INTERVAL_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
```

连接：

```ts
function connectServer() {
    clearReconnectTimer();

    if (socket) {
        try {
            socket.close();
        } catch {
            // ignore
        }
        socket = null;
    }

    setServerStatus(joined ? "reconnecting" : "connecting");
    manuallyClosed = false;

    try {
        socket = new WebSocket(WS_URL);
    } catch {
        onSocketDisconnected();
        return;
    }

    socket.onopen = () => {
        setServerStatus("connected");

        sendJoin();
        startHeartbeat();

        showToast({
            title: "协作服务已连接",
            sub: workbookName || "",
            color: "#22c55e",
            duration: 1800,
        });
    };

    socket.onmessage = event => {
        try {
            const msg = JSON.parse(event.data) as ServerMsg;
            handleServerMsg(msg);
        } catch (err) {
            console.error("handle ws message failed", err);
        }
    };

    socket.onerror = () => {
        // 通常后续会触发 onclose，统一在 onclose 处理
    };

    socket.onclose = () => {
        onSocketDisconnected();
    };
}
```

断开：

```ts
function onSocketDisconnected() {
    stopHeartbeat();

    if (manuallyClosed) {
        setServerStatus("offline", "已离开协作房间");
        return;
    }

    socket = null;

    remoteSelections.clear();
    conflicts = [];

    renderUsers([]);
    renderSelections();
    renderConflicts();
    refreshHighlights();

    setServerStatus("offline", "发布机已下线，10s 后重试连接");
    scheduleReconnect();
}
```

10 秒重连：

```ts
function scheduleReconnect() {
    clearReconnectTimer();
    clearReconnectCountdown();

    let remainSeconds = Math.ceil(RECONNECT_INTERVAL_MS / 1000);
    setServerStatus("offline", `发布机已下线，${remainSeconds}s 后重试连接`);

    reconnectCountdownTimer = window.setInterval(() => {
        remainSeconds--;

        if (remainSeconds > 0) {
            setServerStatus("offline", `发布机已下线，${remainSeconds}s 后重试连接`);
        }
    }, 1000);

    reconnectTimer = window.setTimeout(() => {
        clearReconnectCountdown();
        reconnectTimer = null;
        connectServer();
    }, RECONNECT_INTERVAL_MS);
}
```

安全发送：

```ts
function send(data: unknown) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
    }

    try {
        socket.send(JSON.stringify(data));
        return true;
    } catch {
        return false;
    }
}
```

---

### 7.4 加入房间

```ts
async function join() {
    const info = await getWorkbookInfo();

    workbookName = info.name;
    roomId = makeRoomId(info.fullName);

    $("workbookName").textContent = workbookName;

    joined = true;
    manuallyClosed = false;

    connectServer();
}

function sendJoin() {
    if (!joined || !roomId) {
        return;
    }

    send({
        type: "join",
        roomId,
        userId,
        userName,
        color: myColor,
        workbookName,
    });
}
```

---

### 7.5 离开房间

主动离开时不要自动重连。

```ts
function leaveRoom() {
    manuallyClosed = true;
    joined = false;

    clearReconnectTimer();
    stopHeartbeat();

    try {
        send({ type: "leave" });
    } catch {
        // ignore
    }

    try {
        socket?.close();
    } catch {
        // ignore
    }

    socket = null;

    setServerStatus("offline", "已离开协作房间");
}

window.addEventListener("beforeunload", () => {
    leaveRoom();
});

window.addEventListener("unload", () => {
    leaveRoom();
});
```

注意：插件页面卸载事件不一定 100% 稳定，所以服务端必须保留心跳超时兜底。

---

## 8. WPS API 封装

不同 `wpsjs` 模板中，获取 Application 的方式可能不同。需要封装一个兼容函数。

```ts
async function getApp(): Promise<any> {
    const anyWindow = window as any;

    if (anyWindow.instance?.Application) {
        await anyWindow.instance.ready?.();
        return anyWindow.instance.Application;
    }

    if (anyWindow.wps?.Application) {
        return anyWindow.wps.Application;
    }

    if (anyWindow.Application) {
        return anyWindow.Application;
    }

    throw new Error("找不到 WPS Application 对象，请按 wpsjs 模板调整 getApp()");
}
```

获取当前工作簿：

```ts
async function getWorkbookInfo() {
    const app = await getApp();
    const workbook = await app.ActiveWorkbook;

    const name = await workbook.Name;
    const fullName = await workbook.FullName;

    return {
        name: String(name || "未命名表格"),
        fullName: String(fullName || name || "unknown"),
    };
}
```

---

## 9. WPS 事件绑定

需要监听：

```txt
1. 当前工作簿选区变化
2. 当前 sheet 单元格变化
```

第一版示例：

```ts
async function bindWpsEvents() {
    const app = await getApp();

    try {
        const workbook = await app.ActiveWorkbook;

        workbook.SheetSelectionChange = async function (sheet: any, target: any) {
            await onSelectionChanged(sheet, target);
        };

        const activeSheet = await app.ActiveSheet;
        activeSheet.Change = async function (target: any) {
            await onCellChanged(activeSheet, target);
        };

        console.log("WPS events bound");
    } catch (err) {
        console.error("bindWpsEvents failed", err);
    }
}
```

注意：具体事件绑定形式需要按实际 `wpsjs` 模板调整。Codex 生成后，需要在真实 WPS 环境里验证。

---

### 9.1 选区变化

选区广播需要节流，避免移动鼠标或键盘时频繁发送。

```ts
let lastSelectionSendAt = 0;

async function onSelectionChanged(sheet: any, target: any) {
    const now = Date.now();

    if (now - lastSelectionSendAt < 200) {
        return;
    }

    lastSelectionSendAt = now;

    try {
        const sheetName = String(await sheet.Name);
        const address = normalizeAddress(String(await target.Address));

        send({
            type: "selection",
            sheetName,
            address,
        });
    } catch (err) {
        console.error("onSelectionChanged failed", err);
    }
}

function normalizeAddress(address: string) {
    return address.replace(/\$/g, "");
}
```

---

### 9.2 单元格修改

```ts
async function onCellChanged(sheet: any, target: any) {
    try {
        const sheetName = String(await sheet.Name);
        const address = normalizeAddress(String(await target.Address));
        const newValue = await target.Value;

        send({
            type: "cellChange",
            sheetName,
            address,
            newValue,
        });
    } catch (err) {
        console.error("onCellChanged failed", err);
    }
}
```

---

## 10. Toast 提示

要求：

```txt
其他用户加入：
XXX 加入了房间

其他用户离开：
XXX 离开了房间
```

Toast 容器：

```html
<div id="toastRoot" class="toast-root"></div>
```

实现：

```ts
function showToast(options: {
    title: string;
    sub?: string;
    color?: string;
    duration?: number;
}) {
    const root = document.getElementById("toastRoot");
    if (!root) {
        return;
    }

    const toast = document.createElement("div");
    toast.className = "toast";

    const dot = document.createElement("span");
    dot.className = "toast-dot";
    dot.style.background = options.color || "#4E7FFF";

    const text = document.createElement("div");

    const title = document.createElement("span");
    title.className = "toast-title";
    title.textContent = options.title;

    text.appendChild(title);

    if (options.sub) {
        const sub = document.createElement("span");
        sub.className = "toast-sub";
        sub.textContent = options.sub;
        text.appendChild(sub);
    }

    toast.appendChild(dot);
    toast.appendChild(text);
    root.appendChild(toast);

    const duration = options.duration ?? 2600;

    window.setTimeout(() => {
        toast.classList.add("leaving");

        window.setTimeout(() => {
            toast.remove();
        }, 220);
    }, duration);
}
```

避免重复弹窗：

```ts
const recentToastMap = new Map<string, number>();

function shouldShowUserToast(type: "join" | "left", userId: string) {
    const key = `${type}:${userId}`;
    const now = Date.now();
    const last = recentToastMap.get(key) || 0;

    if (now - last < 5000) {
        return false;
    }

    recentToastMap.set(key, now);
    return true;
}
```

处理消息：

```ts
if (msg.type === "userJoined") {
    if (
        msg.user.userId !== userId &&
        shouldShowUserToast("join", msg.user.userId)
    ) {
        showToast({
            title: `${msg.user.userName} 加入了房间`,
            sub: msg.user.workbookName,
            color: msg.user.color,
            duration: 2600,
        });
    }
    return;
}

if (msg.type === "userLeft") {
    if (
        msg.user.userId !== userId &&
        shouldShowUserToast("left", msg.user.userId)
    ) {
        showToast({
            title: `${msg.user.userName} 离开了房间`,
            sub: msg.user.workbookName,
            color: msg.user.color,
            duration: 2200,
        });
    }
    return;
}
```

---

## 11. UI 渲染

### 11.1 在线用户

```ts
function renderUsers(users: UserInfo[]) {
    const container = $("userList");
    container.innerHTML = "";

    for (const user of users) {
        const div = document.createElement("div");
        div.className = "user-item";
        div.innerHTML = `
            <span class="user-dot" style="background:${user.color}"></span>
            ${escapeHtml(user.userName)}
            ${user.userId === userId ? "（我）" : ""}
        `;
        container.appendChild(div);
    }
}
```

---

### 11.2 远端选区

```ts
const remoteSelections = new Map<string, SelectionInfo>();

function renderSelections() {
    const container = $("selectionList");
    container.innerHTML = "";

    for (const selection of remoteSelections.values()) {
        const div = document.createElement("div");
        div.className = "selection-item";
        div.innerHTML = `
            <span class="user-dot" style="background:${selection.color}"></span>
            ${escapeHtml(selection.userName)}：
            ${escapeHtml(selection.sheetName)}!${escapeHtml(selection.address)}
        `;

        div.onclick = () => {
            jumpToCell(selection.sheetName, selection.address);
        };

        container.appendChild(div);
    }
}
```

---

### 11.3 冲突列表

```ts
let conflicts: ConflictInfo[] = [];

function renderConflicts() {
    const container = $("conflictList");
    container.innerHTML = "";

    for (const conflict of conflicts) {
        const div = document.createElement("div");
        div.className = "conflict-item";

        const users = conflict.users.map(u => u.userName).join("、");
        div.textContent = `${conflict.sheetName}!${conflict.address}：${users}`;

        div.onclick = () => {
            jumpToCell(conflict.sheetName, conflict.address);
        };

        container.appendChild(div);
    }

    renderMiniMap();
}
```

---

### 11.4 右侧迷你标记条

不要尝试修改 WPS 原生滚动条。使用任务窗格中的 `miniMap` 模拟右侧滚动条标记。

```ts
function renderMiniMap() {
    const miniMap = $("miniMap");
    miniMap.innerHTML = "";

    const maxRow = 1000;
    const panelHeight = 260;

    for (const selection of remoteSelections.values()) {
        const row = parseRowFromAddress(selection.address);
        const marker = document.createElement("div");
        marker.className = "marker";
        marker.style.background = selection.color;
        marker.style.top = `${calcMarkerTop(row, maxRow, panelHeight)}px`;
        marker.title = `${selection.userName}: ${selection.sheetName}!${selection.address}`;
        marker.onclick = () => jumpToCell(selection.sheetName, selection.address);
        miniMap.appendChild(marker);
    }

    for (const conflict of conflicts) {
        const row = parseRowFromAddress(conflict.address);
        const marker = document.createElement("div");
        marker.className = "marker";
        marker.style.background = "#ff0000";
        marker.style.height = "6px";
        marker.style.top = `${calcMarkerTop(row, maxRow, panelHeight)}px`;
        marker.title = `冲突: ${conflict.sheetName}!${conflict.address}`;
        marker.onclick = () => jumpToCell(conflict.sheetName, conflict.address);
        miniMap.appendChild(marker);
    }
}

function calcMarkerTop(rowIndex: number, maxRow: number, panelHeight: number) {
    return Math.max(0, Math.min(panelHeight - 6, rowIndex / maxRow * panelHeight));
}

function parseRowFromAddress(address: string) {
    const match = address.match(/\d+/);
    return match ? Number(match[0]) : 1;
}
```

---

## 12. 单元格高亮

第一版可以直接设置底色，但正式版要注意：设置底色会污染原有表格样式。建议先实现功能，再升级为边框优先。

### 12.1 第一版底色高亮

```ts
const originalColors = new Map<string, string | null>();

async function refreshHighlights() {
    try {
        await clearOldHighlights();

        for (const selection of remoteSelections.values()) {
            await highlightCell(selection.sheetName, selection.address, selection.color);
        }

        for (const conflict of conflicts) {
            await highlightCell(conflict.sheetName, conflict.address, "#ff4d4f");
        }
    } catch (err) {
        console.error("refreshHighlights failed", err);
    }
}

async function highlightCell(sheetName: string, address: string, color: string) {
    const app = await getApp();

    const sheet = await app.Worksheets.Item(sheetName);
    const range = await sheet.Range(address);

    const key = `${sheetName}!${address}`;

    if (!originalColors.has(key)) {
        try {
            const interior = await range.Interior;
            const oldColor = await interior.Color;
            originalColors.set(key, oldColor || null);
        } catch {
            originalColors.set(key, null);
        }
    }

    const interior = await range.Interior;
    interior.Color = color;
}

async function clearOldHighlights() {
    const app = await getApp();

    for (const [key, color] of originalColors.entries()) {
        const [sheetName, address] = key.split("!");
        if (!sheetName || !address) {
            continue;
        }

        try {
            const sheet = await app.Worksheets.Item(sheetName);
            const range = await sheet.Range(address);
            const interior = await range.Interior;

            if (color) {
                interior.Color = color;
            } else {
                interior.Color = "#ffffff";
            }
        } catch {
            // ignore
        }
    }

    originalColors.clear();
}
```

### 12.2 高亮优先级

必须保证冲突红色优先级最高：

```txt
冲突红色 > 本地未保存改动 > 对方已修改 > 对方当前选区 > 普通状态
```

第一版可只实现：

```txt
冲突红色 > 对方当前选区
```

---

## 13. 点击跳转

远端选区、冲突列表、迷你标记条点击后跳转到单元格。

```ts
async function jumpToCell(sheetName: string, address: string) {
    const app = await getApp();

    const sheet = await app.Worksheets.Item(sheetName);
    await sheet.Activate();

    const range = await sheet.Range(address);
    await range.Select();
}
```

---

## 14. CSS 要点

### 14.1 服务器状态条

```css
.server-status {
    display: flex;
    align-items: center;
    gap: 8px;

    box-sizing: border-box;
    width: 100%;
    margin-bottom: 10px;
    padding: 8px 10px;

    border-radius: 8px;
    font-size: 13px;
    line-height: 18px;

    background: #f1f5f9;
    color: #64748b;
    border: 1px solid #e2e8f0;
}

.server-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #94a3b8;
    flex: 0 0 auto;
}

.server-status.connected {
    background: #ecfdf5;
    color: #047857;
    border-color: #bbf7d0;
}

.server-status.connected .server-status-dot {
    background: #22c55e;
}

.server-status.connecting,
.server-status.reconnecting {
    background: #fffbeb;
    color: #b45309;
    border-color: #fde68a;
}

.server-status.connecting .server-status-dot,
.server-status.reconnecting .server-status-dot {
    background: #f59e0b;
}

.server-status.offline {
    background: #f1f5f9;
    color: #64748b;
    border-color: #e2e8f0;
}

.server-status.offline .server-status-dot {
    background: #94a3b8;
}
```

### 14.2 Toast

```css
.toast-root {
    position: fixed;
    top: 10px;
    left: 10px;
    right: 10px;
    z-index: 9999;
    pointer-events: none;
}

.toast {
    display: flex;
    align-items: center;
    gap: 8px;

    box-sizing: border-box;
    width: 100%;
    margin-bottom: 8px;
    padding: 9px 12px;

    border-radius: 8px;
    background: rgba(30, 41, 59, 0.94);
    color: #fff;

    font-size: 13px;
    line-height: 18px;

    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);

    transform: translateY(-8px);
    opacity: 0;

    animation: toast-in 160ms ease-out forwards;
}

.toast-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: 0 0 auto;
}

.toast-title {
    font-weight: 600;
}

.toast-sub {
    color: rgba(255, 255, 255, 0.72);
    margin-left: 4px;
}

.toast.leaving {
    animation: toast-out 180ms ease-in forwards;
}

@keyframes toast-in {
    from {
        transform: translateY(-8px);
        opacity: 0;
    }
    to {
        transform: translateY(0);
        opacity: 1;
    }
}

@keyframes toast-out {
    from {
        transform: translateY(0);
        opacity: 1;
    }
    to {
        transform: translateY(-8px);
        opacity: 0;
    }
}
```

### 14.3 迷你标记条

```css
.mini-map {
    position: relative;
    height: 260px;
    background: linear-gradient(#f5f5f5, #fafafa);
    border: 1px solid #ddd;
    border-radius: 6px;
    overflow: hidden;
}

.marker {
    position: absolute;
    left: 4px;
    right: 4px;
    height: 4px;
    border-radius: 2px;
    cursor: pointer;
}
```

---

## 15. 初始化流程

插件启动后：

```txt
1. 页面加载
2. 初始化顶部状态为 offline：发布机已下线
3. 用户点击“加入协作”
4. 读取当前工作簿 name/fullName
5. 生成 roomId
6. 解析用户身份和固定颜色
7. 连接 WebSocket 服务端
8. 连接成功后发送 join
9. 绑定 WPS 选区变化和单元格变化事件
10. 收到 joined 后渲染当前房间状态
```

伪代码：

```ts
window.addEventListener("DOMContentLoaded", () => {
    $("joinBtn").addEventListener("click", () => {
        join().catch(err => {
            console.error(err);
            alert(`加入协作失败：${err?.message || err}`);
        });
    });

    const reconnectBtn = document.getElementById("reconnectBtn");
    reconnectBtn?.addEventListener("click", () => {
        connectServer();
    });

    setServerStatus("offline", "发布机已下线");
});
```

---

## 16. 消息处理流程

```ts
function handleServerMsg(msg: ServerMsg) {
    if (msg.type === "joined") {
        renderUsers(msg.users);

        remoteSelections.clear();
        for (const selection of msg.selections) {
            if (selection.userId !== userId) {
                remoteSelections.set(selection.userId, selection);
            }
        }

        conflicts = msg.conflicts || [];

        renderSelections();
        renderConflicts();
        refreshHighlights();
        return;
    }

    if (msg.type === "userJoined") {
        if (
            msg.user.userId !== userId &&
            shouldShowUserToast("join", msg.user.userId)
        ) {
            showToast({
                title: `${msg.user.userName} 加入了房间`,
                sub: msg.user.workbookName,
                color: msg.user.color,
                duration: 2600,
            });
        }
        return;
    }

    if (msg.type === "userLeft") {
        if (
            msg.user.userId !== userId &&
            shouldShowUserToast("left", msg.user.userId)
        ) {
            showToast({
                title: `${msg.user.userName} 离开了房间`,
                sub: msg.user.workbookName,
                color: msg.user.color,
                duration: 2200,
            });
        }
        return;
    }

    if (msg.type === "presence") {
        renderUsers(msg.users);
        return;
    }

    if (msg.type === "selection") {
        if (msg.selection.userId !== userId) {
            remoteSelections.set(msg.selection.userId, msg.selection);
            renderSelections();
            renderMiniMap();
            refreshHighlights();
        }
        return;
    }

    if (msg.type === "selectionRemoved") {
        remoteSelections.delete(msg.userId);
        renderSelections();
        renderMiniMap();
        refreshHighlights();
        return;
    }

    if (msg.type === "conflicts") {
        conflicts = msg.conflicts || [];
        renderConflicts();
        refreshHighlights();
        return;
    }

    if (msg.type === "cellChange") {
        return;
    }

    if (msg.type === "error") {
        console.warn("server error:", msg.message);
        return;
    }
}
```

---

## 17. 第一版验收标准

### 17.1 服务端未启动

操作：

```txt
1. 不启动 server
2. 打开 WPS 插件
3. 点击加入协作
```

期望：

```txt
顶部灰色显示：发布机已下线，10s 后重试连接
每 10 秒自动重连
不会不断弹错误 alert
```

---

### 17.2 服务端启动后自动恢复

操作：

```txt
1. 插件处于发布机下线状态
2. 启动 server
```

期望：

```txt
插件自动连接成功
顶部变绿：协作服务已连接
自动加入当前表格房间
```

---

### 17.3 两个用户打开同一表格

操作：

```txt
1. A 打开 item.xlsx 并加入协作
2. B 打开同一个 item.xlsx 并加入协作
```

期望：

```txt
A 看到 toast：B 加入了房间
B 看到在线用户：A、B
A 看到在线用户：A、B
```

---

### 17.4 用户离开

操作：

```txt
1. A、B 都在房间
2. B 关闭表格或关闭插件
```

期望：

```txt
A 看到 toast：B 离开了房间
A 在线用户列表移除 B
A 远端选区移除 B
```

如果主动关闭事件没有触发，应在心跳超时后完成同样效果。

---

### 17.5 选区同步

操作：

```txt
1. A 选中 Sheet1!B20
```

期望：

```txt
B 右侧远端选区显示：A：Sheet1!B20
B 的 Sheet1!B20 被 A 的颜色高亮
B 的 mini map 出现 A 的颜色标记
点击标记可跳转到 Sheet1!B20
```

---

### 17.6 冲突高亮

操作：

```txt
1. A 修改 Sheet1!B20
2. B 也修改 Sheet1!B20
```

期望：

```txt
A、B 都看到冲突列表：Sheet1!B20
Sheet1!B20 被红色高亮
mini map 出现红色标记
```

---

### 17.7 服务器意外关闭

操作：

```txt
1. A、B 已连接
2. 关闭 server
```

期望：

```txt
A、B 顶部都变灰：发布机已下线，10s 后重试连接
在线用户、远端选区、冲突状态清空或置为不可用
每 10 秒自动尝试重连
server 恢复后自动重新加入房间
```

---

## 18. 后续升级方向

### 18.1 冲突 key 从地址升级为业务字段

第一版：

```txt
sheetName + address
```

正式版：

```txt
sheetName + id + field
```

假设表结构：

```txt
第 1 行：字段名
第 2 行：类型
第 3 行：描述
第 4 行开始：数据
A 列：id
```

用户修改 `D20` 时：

```txt
field = D1
id = A20
conflictKey = Sheet1::10001::price
```

示例：

```ts
async function getBusinessKey(sheet: any, target: any) {
    const sheetName = String(await sheet.Name);
    const address = normalizeAddress(String(await target.Address));

    const row = parseRowFromAddress(address);
    const col = parseColFromAddress(address);

    const idRange = await sheet.Range(`A${row}`);
    const id = await idRange.Value;

    const fieldAddress = `${colToName(col)}1`;
    const fieldRange = await sheet.Range(fieldAddress);
    const field = await fieldRange.Value;

    return {
        sheetName,
        id: String(id),
        field: String(field),
        address,
    };
}
```

---

### 18.2 本地 Agent

WPS 插件只能管打开插件的人。后续建议增加本地 Agent：

```txt
Node/Electron Agent：
1. 开机启动
2. 扫描 xls 目录
3. 检查 Excel/WPS 锁文件
4. 提供 http://127.0.0.1:18081/me 获取电脑用户名
5. Git pre-commit 检查冲突
6. Git pull 后通知插件刷新
7. 和中心服务器同步文件版本
```

插件通过本地 Agent 获取电脑用户：

```ts
async function getLocalAgentUserInfo() {
    try {
        const res = await fetch("http://127.0.0.1:18081/me");
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}
```

---

### 18.3 保存前版本检查

后续增加：

```txt
打开表格时记录 serverVersion
保存前检查 serverVersion 是否变化
如果远端版本变化，提示用户先刷新/合并
```

---

### 18.4 冲突处理 UI

后续冲突处理按钮：

```txt
使用我的
使用他的
修改冲突 ID
顺延 ID
放弃我的修改
```

这部分不要放在第一版，等字段级冲突稳定后再做。

---

## 19. 实现注意事项

1. 不要尝试修改 WPS 原生滚动条，使用任务窗格 mini map 模拟。
2. 不要只依赖页面 unload 发送 leave，必须有心跳超时兜底。
3. 不要把 `Application.UserName` 当唯一用户 ID，它可以作为显示名，但不稳定。
4. 远端选区事件必须节流，建议 200ms。
5. 单元格高亮第一版可以用底色，但正式版应尽量使用边框或保存并恢复原样式。
6. 冲突红色优先级必须高于远端选区颜色。
7. 服务器重启后，插件需要自动重新 join 当前 room。
8. `roomId` 第一版可以用完整路径，但正式版要改成仓库相对路径。
9. 多 sheet 场景必须带上 `sheetName`。
10. 大范围选择不要逐格高亮，第一版可以只处理单个地址或小范围地址。
11. WPS 事件绑定方式可能受 `wpsjs` 模板和 WPS 版本影响，需要在真实环境验证。
12. 服务端第一版可以只放内存，后续如需审计和版本管理再接数据库。

---

## 20. Codex 实现任务建议

请 Codex 按以下顺序实现：

```txt
1. 创建 wps-anybody-here/server
2. 实现 WebSocket server、room manager、协议类型
3. 实现 join/leave/heartbeat/presence/userJoined/userLeft
4. 实现 selection 广播
5. 实现 cellChange 和 address 级冲突检测
6. 创建 wps-anybody-here/addin/src 页面
7. 实现 server status bar、toast、用户列表、选区列表、冲突列表、mini map
8. 实现 WebSocket 客户端和 10 秒重连
9. 实现用户身份和固定颜色
10. 封装 getApp/getWorkbookInfo/jumpToCell/highlightCell
11. 接入 WPS 事件：SheetSelectionChange、Change
12. 在真实 WPS 环境中修正事件绑定方式
13. 完成第一版验收测试
```

第一版不要追求完整协同编辑，先保证：

```txt
谁在房间
谁加入/离开
谁选中了哪里
谁和谁改了同一格
服务挂了能恢复
```
