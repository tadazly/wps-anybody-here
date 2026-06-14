(function () {
    const DEFAULT_WS_URL = "ws://127.0.0.1:18080";
    const STORAGE_KEYS = {
        serverUrl: "wpsAnybodyHere.serverUrl",
        user: "wpsAnybodyHere.user",
        repoUrl: "wpsAnybodyHere.repoUrl",
        repoRoot: "wpsAnybodyHere.repoRoot",
        settingsSaved: "wpsAnybodyHere.settingsSaved",
    };

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

    const RECONNECT_INTERVAL_MS = 10_000;
    const HEARTBEAT_INTERVAL_MS = 5_000;
    const SELECTION_THROTTLE_MS = 200;
    const AUTO_JOIN_DELAY_MS = 500;
    const AUTO_JOIN_RETRY_MS = 2000;
    const CONFLICT_COLOR = "#ff4d4f";
    const CONFLICT_FILL_COLOR = "#fde8ea";
    const CONFLICT_BORDER_COLOR = "#ff0000";
    const BORDER_EDGE_INDEXES = [7, 8, 9, 10];
    const SELECTION_LABEL_PREFIX = "AnybodyHereSelectionLabel_";
    const SELECTION_LABEL_MAX_HEIGHT = 9;
    const SELECTION_LABEL_MIN_HEIGHT = 5;
    const SELECTION_LABEL_MAX_WIDTH = 86;
    const SELECTION_LABEL_MIN_WIDTH = 12;
    const SELECTION_LABEL_FONT_SIZE = 6;
    const MSO_TEXT_ORIENTATION_HORIZONTAL = 1;
    const MSO_ALIGN_CENTER = 2;
    const MSO_ANCHOR_MIDDLE = 3;
    const XL_H_ALIGN_CENTER = -4108;
    const XL_V_ALIGN_CENTER = -4108;
    const XL_COLOR_INDEX_NONE = -4142;
    const XL_LINE_STYLE_NONE = -4142;
    const XL_LINE_STYLE_CONTINUOUS = 1;
    const XL_PATTERN_SOLID = 1;
    const XL_BORDER_WEIGHT_THIN = 2;
    const XL_BORDER_WEIGHT_MEDIUM = -4138;

    const roomConnections = new Map();
    let reconnectCountdownTimer = null;
    let heartbeatTimer = null;
    let selectionTimer = null;
    let workbookScanTimer = null;
    let autoJoinTimer = null;
    let lastAutoJoinMessage = "";
    let eventsBound = false;

    let joined = false;
    let manuallyClosed = false;
    let roomId = "";
    let workbookName = "";
    let workbookFullName = "";
    let myUser = null;
    let pendingColorMode = "auto";
    let pendingCustomColor = "";
    let currentUsers = [];
    let conflicts = [];

    const remoteSelections = new Map();
    const originalHighlights = new Map();
    const recentToastMap = new Map();

    function $(id) {
        return document.getElementById(id);
    }

    function log(message) {
        const logList = $("logList");
        if (!logList) {
            return;
        }

        const time = new Date().toLocaleTimeString();
        const line = `[${time}] ${message}`;
        const old = logList.textContent === "等待加入协作..." ? "" : logList.textContent;
        logList.textContent = [line, old].filter(Boolean).join("\n");
    }

    function hashString(str) {
        let hash = 2166136261;

        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }

        return hash >>> 0;
    }

    function colorFromSeed(seed) {
        const hash = hashString(seed);
        return USER_COLORS[hash % USER_COLORS.length];
    }

    function normalizeHexColor(value) {
        const normalized = String(value || "").trim();
        return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : "";
    }

    function resolveUserColor(userId, colorMode, customColor) {
        const custom = normalizeHexColor(customColor);
        if (colorMode === "custom" && custom) {
            return custom;
        }

        return colorFromSeed(userId);
    }

    function makeUser(userId, userName, colorMode, customColor) {
        const normalizedMode = colorMode === "custom" && normalizeHexColor(customColor) ? "custom" : "auto";
        const normalizedCustomColor = normalizedMode === "custom" ? normalizeHexColor(customColor) : "";

        return {
            userId,
            userName,
            colorMode: normalizedMode,
            customColor: normalizedCustomColor,
            color: resolveUserColor(userId, normalizedMode, normalizedCustomColor),
        };
    }

    function persistUser(user, options) {
        localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
        myUser = user;
        syncColorDraftFromUser(user);

        if (!options || options.updateNameInput !== false) {
            const input = $("userNameInput");
            if (input) {
                input.value = user.userName;
            }
        }

        renderUserColorControls();
    }

    function createUserId() {
        const randomPart = Math.floor(Math.random() * 0xffffffff).toString(16);
        return `local:${Date.now().toString(16)}${randomPart}`;
    }

    function loadUser() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || "null");
            if (saved && saved.userId && saved.userName) {
                const customColor = normalizeHexColor(saved.customColor || "");
                const colorMode = saved.colorMode === "custom" && customColor ? "custom" : "auto";
                return makeUser(saved.userId, saved.userName, colorMode, customColor);
            }
        } catch {
            // ignore
        }

        return null;
    }

    function saveUserName(name, colorOptions) {
        const userName = name.trim();
        if (!userName) {
            alert("请先填写你的名字，其他人会用这个名字识别你。");
            return null;
        }

        const current = myUser || loadUser();
        const userId = current && current.userId ? current.userId : createUserId();
        const colorMode = colorOptions && colorOptions.colorMode ? colorOptions.colorMode : pendingColorMode;
        const customColor = colorOptions && Object.prototype.hasOwnProperty.call(colorOptions, "customColor")
            ? colorOptions.customColor
            : pendingCustomColor;
        const user = makeUser(userId, userName, colorMode, customColor);

        const oldName = current && current.userName ? current.userName : "";
        persistUser(user);

        if (oldName !== userName) {
            log(`当前身份：${userName}`);
        }

        return user;
    }

    function syncColorDraftFromUser(user) {
        pendingColorMode = user && user.colorMode === "custom" ? "custom" : "auto";
        pendingCustomColor = user && user.customColor ? normalizeHexColor(user.customColor) : "";
    }

    function getColorDraftOptions() {
        return {
            colorMode: pendingColorMode,
            customColor: pendingCustomColor,
        };
    }

    function getColorPreview() {
        if (pendingColorMode === "custom" && pendingCustomColor) {
            return pendingCustomColor;
        }

        if (myUser && myUser.userId) {
            return colorFromSeed(myUser.userId);
        }

        return USER_COLORS[0];
    }

    function renderUserColorControls() {
        const colorInput = $("userColorInput");
        const autoBtn = $("userColorAutoBtn");
        const hint = $("userColorHint");
        const previewColor = getColorPreview();

        if (colorInput) {
            colorInput.value = previewColor;
            colorInput.title = pendingColorMode === "custom" ? "当前使用自定义颜色" : "当前使用自动分配颜色";
        }

        if (autoBtn) {
            autoBtn.classList.toggle("active", pendingColorMode !== "custom");
        }

        if (hint) {
            hint.textContent = pendingColorMode === "custom"
                ? `当前使用自定义颜色 ${previewColor}`
                : `当前使用自动分配颜色 ${previewColor}`;
        }
    }

    function updateCurrentUserColor(colorMode, customColor) {
        const current = myUser || loadUser();
        if (!current) {
            pendingColorMode = colorMode === "custom" && normalizeHexColor(customColor) ? "custom" : "auto";
            pendingCustomColor = pendingColorMode === "custom" ? normalizeHexColor(customColor) : "";
            renderUserColorControls();
            return null;
        }

        const user = makeUser(current.userId, current.userName, colorMode, customColor);
        persistUser(user, { updateNameInput: false });
        syncUserProfile();
        updateLocalUserColor(user);
        return user;
    }

    function ensureUser() {
        if (myUser) {
            return myUser;
        }

        myUser = loadUser();
        if (myUser) {
            return myUser;
        }

        const inputName = $("userNameInput") ? $("userNameInput").value.trim() : "";
        if (inputName) {
            return saveUserName(inputName);
        }

        const fallbackName = getWpsUserName();
        if (fallbackName) {
            return saveUserName(fallbackName);
        }

        return saveUserName(`用户-${createUserId().slice(-4).toUpperCase()}`);
    }

    function getWpsUserName() {
        try {
            const app = getApp();
            if (app && app.UserName) {
                return String(app.UserName);
            }
        } catch {
            // ignore
        }

        return "";
    }

    function getServerUrl() {
        return (localStorage.getItem(STORAGE_KEYS.serverUrl) || DEFAULT_WS_URL).trim();
    }

    function normalizeRepoUrl(value) {
        return String(value || "").trim().replace(/\/+$/, "");
    }

    function getRepoUrl() {
        return normalizeRepoUrl(localStorage.getItem(STORAGE_KEYS.repoUrl) || "");
    }

    function getRepoRoot() {
        return normalizeWorkbookPath(localStorage.getItem(STORAGE_KEYS.repoRoot) || "").replace(/\/$/, "");
    }

    function hasSavedSettings() {
        return localStorage.getItem(STORAGE_KEYS.settingsSaved) === "1";
    }

    function setSettingsError(message) {
        const el = $("settingsError");
        if (!el) {
            return;
        }

        el.textContent = message || "";
        el.style.display = message ? "block" : "none";
    }

    function openSettingsModal(force) {
        const modal = $("settingsModal");
        if (!modal) {
            return;
        }

        const firstRun = force && !hasSavedSettings();
        const savedUser = myUser || loadUser();
        if (!myUser && savedUser) {
            myUser = savedUser;
        }
        $("serverUrlInput").value = getServerUrl();
        $("repoUrlInput").value = firstRun ? "" : getRepoUrl();
        $("repoRootInput").value = firstRun ? "" : getRepoRoot();
        $("userNameInput").value = savedUser ? savedUser.userName : getWpsUserName();
        syncColorDraftFromUser(savedUser);
        renderUserColorControls();
        modal.dataset.force = force ? "true" : "false";
        modal.classList.add("open");
        $("closeSettingsBtn").style.display = force ? "none" : "inline-flex";
        setSettingsError("");
        window.setTimeout(function () {
            $("serverUrlInput").focus();
        }, 0);
    }

    function closeSettingsModal() {
        const modal = $("settingsModal");
        if (!modal || modal.dataset.force === "true") {
            return;
        }

        modal.classList.remove("open");
        setSettingsError("");
    }

    function saveSettings() {
        const serverUrl = $("serverUrlInput").value.trim() || DEFAULT_WS_URL;
        const repoUrl = normalizeRepoUrl($("repoUrlInput").value);
        const repoRoot = normalizeWorkbookPath($("repoRootInput").value.trim()).replace(/\/$/, "");
        const userName = $("userNameInput").value.trim();

        if (!serverUrl) {
            setSettingsError("请填写服务器 socket 地址。");
            return;
        }
        if (!repoUrl) {
            setSettingsError("请填写表格仓库地址，用于区分不同项目的同名表。");
            return;
        }
        if (!repoRoot) {
            setSettingsError("请填写本地仓库根目录。");
            return;
        }
        if (!userName) {
            setSettingsError("请填写用户名。");
            return;
        }

        const oldServerUrl = getServerUrl();
        const oldRepoUrl = getRepoUrl();
        const oldRepoRoot = getRepoRoot();

        localStorage.setItem(STORAGE_KEYS.serverUrl, serverUrl);
        localStorage.setItem(STORAGE_KEYS.repoUrl, repoUrl);
        localStorage.setItem(STORAGE_KEYS.repoRoot, repoRoot);
        localStorage.setItem(STORAGE_KEYS.settingsSaved, "1");
        $("serverUrlInput").value = serverUrl;
        $("repoUrlInput").value = repoUrl;
        $("repoRootInput").value = repoRoot;

        const user = saveUserName(userName, getColorDraftOptions());
        if (!user) {
            return;
        }

        $("settingsModal").dataset.force = "false";
        $("settingsModal").classList.remove("open");
        setSettingsError("");
        log("协作设置已保存");

        if (joined) {
            if (oldRepoUrl !== repoUrl || oldRepoRoot !== repoRoot) {
                restartWorkbookConnections();
            } else if (oldServerUrl !== serverUrl) {
                for (const connection of roomConnections.values()) {
                    connectRoom(connection);
                }
            } else {
                updateLocalUserColor(user);
                syncUserProfile();
            }
        } else {
            autoJoinRoom();
        }
    }

    function bindCommitOnEnter(input, commit) {
        input.addEventListener("keydown", function (event) {
            if (event.key !== "Enter") {
                return;
            }

            event.preventDefault();
            commit();
            input.blur();
        });
    }

    function getApp() {
        const app = window.Application || (window.wps && window.wps.Application);
        if (!app) {
            throw new Error("当前页面没有拿到 WPS Application 对象，请在 WPS 加载项任务窗格中打开。");
        }

        return app;
    }

    function getWorkbookInfo() {
        const app = getApp();
        const workbook = safeGet(function () {
            return app.ActiveWorkbook;
        }, null);

        if (!workbook) {
            throw new Error("当前没有打开任何表格。");
        }

        return getWorkbookInfoFromWorkbook(workbook);
    }

    function getWorkbookInfoFromWorkbook(workbook) {
        const name = safeString(safeGet(function () {
            return workbook.Name;
        }, ""), "未命名表格");
        const fullName = safeString(safeGet(function () {
            return workbook.FullName;
        }, ""), "") ||
            joinPath(safeString(safeGet(function () {
                return workbook.Path;
            }, ""), ""), name) ||
            name;

        return {
            name,
            fullName,
        };
    }

    function listOpenWorkbookInfos() {
        const app = getApp();
        const workbooks = safeGet(function () {
            return app.Workbooks;
        }, null);
        const count = Number(safeGet(function () {
            return workbooks ? workbooks.Count : 0;
        }, 0)) || 0;
        const infos = [];
        const seen = new Set();

        for (let i = 1; i <= count; i++) {
            const workbook = safeGet(function () {
                return workbooks.Item(i);
            }, null);

            if (!workbook) {
                continue;
            }

            const info = getWorkbookInfoFromWorkbook(workbook);
            const id = makeRoomId(info.fullName);
            if (seen.has(id)) {
                continue;
            }

            seen.add(id);
            infos.push(info);
        }

        if (!infos.length) {
            infos.push(getWorkbookInfo());
        }

        return infos;
    }

    function safeGet(fn, fallback) {
        try {
            const value = fn();
            return value === undefined || value === null ? fallback : value;
        } catch {
            return fallback;
        }
    }

    function safeString(value, fallback) {
        try {
            if (value === undefined || value === null) {
                return fallback;
            }
            return String(value);
        } catch {
            return fallback;
        }
    }

    function joinPath(path, name) {
        if (!path) {
            return name;
        }

        return `${path.replace(/[\\\/]+$/, "")}/${name}`;
    }

    function normalizeWorkbookPath(path) {
        return String(path || "").replace(/\\/g, "/").replace(/\/+/g, "/");
    }

    function getRepoRelativePath(fullName) {
        const normalized = normalizeWorkbookPath(fullName);
        const root = getRepoRoot();
        if (!root) {
            return "";
        }

        const normalizedLower = normalized.toLowerCase();
        const rootLower = root.toLowerCase();
        if (normalizedLower === rootLower) {
            return "";
        }
        if (normalizedLower.indexOf(rootLower + "/") !== 0) {
            return "";
        }

        return normalized.slice(root.length + 1);
    }

    function makeRoomId(fullName) {
        const fileId = getRepoRelativePath(fullName) || normalizeWorkbookPath(fullName);
        const repoUrl = getRepoUrl();
        return (repoUrl ? `${repoUrl}::${fileId}` : fileId).toLowerCase();
    }

    function setServerStatus(status, text) {
        const bar = $("serverStatusBar");
        const statusText = $("serverStatusText");
        if (!bar || !statusText) {
            return;
        }

        bar.className = `server-status ${status}`;
        statusText.textContent = text || statusTextFromStatus(status);
    }

    function statusTextFromStatus(status) {
        if (status === "connected") {
            return "协作服务已连接";
        }
        if (status === "connecting") {
            return "正在连接发布机...";
        }
        if (status === "reconnecting") {
            return "发布机已下线，正在尝试重新连接...";
        }
        return "发布机已下线";
    }

    async function joinRoom() {
        const user = ensureUser();
        if (!user) {
            return;
        }

        joined = true;
        manuallyClosed = false;

        bindWpsEvents();
        syncOpenWorkbooks();
        startWorkbookScanner();
        startHeartbeat();
    }

    function leaveRoom() {
        manuallyClosed = true;
        joined = false;

        stopWorkbookScanner();
        clearReconnectTimers();
        clearReconnectCountdown();
        stopHeartbeat();
        unbindWpsEvents();

        for (const connection of roomConnections.values()) {
            sendToConnection(connection, { type: "leave" });
            closeConnection(connection);
        }
        roomConnections.clear();
        roomId = "";
        workbookName = "";
        workbookFullName = "";
        remoteSelections.clear();
        conflicts = [];
        currentUsers = [];
        renderUsers([]);
        renderSelections();
        renderConflicts();
        refreshHighlights();

        setServerStatus("offline", "已离开协作房间");
        log("已离开协作房间");
    }

    function restartWorkbookConnections() {
        if (!joined) {
            return;
        }

        for (const connection of roomConnections.values()) {
            sendToConnection(connection, { type: "leave" });
            closeConnection(connection);
        }

        roomConnections.clear();
        roomId = "";
        workbookName = "";
        workbookFullName = "";
        remoteSelections.clear();
        conflicts = [];
        currentUsers = [];
        renderUsers([]);
        renderSelections();
        renderConflicts();
        refreshHighlights();
        syncOpenWorkbooks();
    }

    function syncOpenWorkbooks() {
        if (!joined) {
            return;
        }

        const activeInfo = getWorkbookInfo();
        const activeRoomId = makeRoomId(activeInfo.fullName);
        const infos = listOpenWorkbookInfos();
        const openRoomIds = new Set();

        for (const info of infos) {
            const nextRoomId = makeRoomId(info.fullName);
            openRoomIds.add(nextRoomId);

            let connection = roomConnections.get(nextRoomId);
            if (!connection) {
                connection = createConnection(info);
                roomConnections.set(nextRoomId, connection);
                connectRoom(connection);
            } else {
                connection.workbookName = info.name;
                connection.workbookFullName = info.fullName;
            }
        }

        for (const entry of Array.from(roomConnections.entries())) {
            const nextRoomId = entry[0];
            const connection = entry[1];
            if (!openRoomIds.has(nextRoomId)) {
                sendToConnection(connection, { type: "leave" });
                closeConnection(connection);
                roomConnections.delete(nextRoomId);
                log(`已移除关闭的表格房间：${connection.workbookName}`);
            }
        }

        setActiveWorkbook(activeInfo);
        updateServerStatus();
    }

    function createConnection(info) {
        return {
            socket: null,
            roomId: makeRoomId(info.fullName),
            workbookName: info.name,
            workbookFullName: info.fullName,
            users: [],
            selections: new Map(),
            conflicts: [],
            reconnectTimer: null,
            reconnectRemainSeconds: 0,
        };
    }

    function setActiveWorkbook(info) {
        const nextRoomId = makeRoomId(info.fullName);
        const changed = roomId !== nextRoomId;

        roomId = nextRoomId;
        workbookName = info.name;
        workbookFullName = info.fullName;

        const workbookBox = $("workbookName");
        workbookBox.textContent = workbookName;
        workbookBox.title = workbookFullName;
        workbookBox.classList.remove("muted");

        if (changed) {
            log(`当前表格切换为：${workbookName}`);
        }

        renderActiveRoomState();
    }

    function getActiveConnection() {
        return roomId ? roomConnections.get(roomId) || null : null;
    }

    function connectServer() {
        syncOpenWorkbooks();
        const connection = getActiveConnection();
        if (connection) {
            connectRoom(connection);
        }
    }

    function connectRoom(connection) {
        if (!joined) {
            return;
        }

        clearConnectionReconnectTimer(connection);

        if (!window.WebSocket) {
            setServerStatus("offline", "当前 WPS WebView 不支持 WebSocket");
            log("当前 WPS WebView 不支持 WebSocket。");
            scheduleReconnect(connection);
            return;
        }

        closeConnection(connection);

        const wsUrl = getServerUrl();
        manuallyClosed = false;
        updateServerStatus();

        try {
            connection.socket = new WebSocket(wsUrl);
        } catch (err) {
            log(`创建 WebSocket 失败：${err.message || err}`);
            onConnectionDisconnected(connection);
            return;
        }

        connection.socket.onopen = function () {
            sendJoin(connection);
            updateServerStatus();
            showToast({
                title: "协作服务已连接",
                sub: connection.workbookName,
                color: "#22c55e",
                duration: 1800,
            });
            log(`已连接：${connection.workbookName} -> ${wsUrl}`);
        };

        connection.socket.onmessage = function (event) {
            try {
                handleServerMsg(connection, JSON.parse(event.data));
            } catch (err) {
                console.error("handle ws message failed", err);
                log("收到无法解析的服务端消息");
            }
        };

        connection.socket.onerror = function (event) {
            console.error("websocket error", event);
            log(`协作连接发生错误：${connection.workbookName}，请确认服务地址 ${wsUrl}`);
        };

        connection.socket.onclose = function (event) {
            if (event && (event.code || event.reason)) {
                log(`协作连接关闭：${connection.workbookName} code=${event.code || ""} ${event.reason || ""}`);
            }
            onConnectionDisconnected(connection);
        };
    }

    function closeConnection(connection) {
        if (!connection || !connection.socket) {
            return;
        }

        connection.socket.onopen = null;
        connection.socket.onmessage = null;
        connection.socket.onerror = null;
        connection.socket.onclose = null;

        try {
            connection.socket.close();
        } catch {
            // ignore
        }

        connection.socket = null;
    }

    function onConnectionDisconnected(connection) {
        if (manuallyClosed) {
            setServerStatus("offline", "已离开协作房间");
            return;
        }

        connection.socket = null;
        connection.users = [];
        connection.selections.clear();
        connection.conflicts = [];

        if (connection.roomId === roomId) {
            renderActiveRoomState();
        }

        updateServerStatus();
        log(`发布机已下线或连接断开：${connection.workbookName}`);
        scheduleReconnect(connection);
    }

    function scheduleReconnect(connection) {
        if (!joined || !connection) {
            return;
        }

        clearConnectionReconnectTimer(connection);
        connection.reconnectRemainSeconds = Math.ceil(RECONNECT_INTERVAL_MS / 1000);
        startReconnectCountdownTicker();
        updateServerStatus();

        connection.reconnectTimer = window.setTimeout(function () {
            connection.reconnectTimer = null;
            connection.reconnectRemainSeconds = 0;
            stopReconnectCountdownTickerIfIdle();
            connectRoom(connection);
        }, RECONNECT_INTERVAL_MS);
    }

    function clearConnectionReconnectTimer(connection) {
        if (connection && connection.reconnectTimer) {
            window.clearTimeout(connection.reconnectTimer);
            connection.reconnectTimer = null;
            connection.reconnectRemainSeconds = 0;
        }

        stopReconnectCountdownTickerIfIdle();
    }

    function clearReconnectTimers() {
        for (const connection of roomConnections.values()) {
            clearConnectionReconnectTimer(connection);
        }
    }

    function clearReconnectCountdown() {
        if (reconnectCountdownTimer) {
            window.clearInterval(reconnectCountdownTimer);
            reconnectCountdownTimer = null;
        }
    }

    function startReconnectCountdownTicker() {
        if (reconnectCountdownTimer) {
            return;
        }

        reconnectCountdownTimer = window.setInterval(function () {
            let hasReconnect = false;

            for (const connection of roomConnections.values()) {
                if (!connection.reconnectTimer) {
                    connection.reconnectRemainSeconds = 0;
                    continue;
                }

                hasReconnect = true;
                connection.reconnectRemainSeconds = Math.max(1, (connection.reconnectRemainSeconds || 1) - 1);
            }

            updateServerStatus();

            if (!hasReconnect) {
                clearReconnectCountdown();
            }
        }, 1000);
    }

    function stopReconnectCountdownTickerIfIdle() {
        for (const connection of roomConnections.values()) {
            if (connection.reconnectTimer) {
                return;
            }
        }

        clearReconnectCountdown();
    }

    function startHeartbeat() {
        stopHeartbeat();
        heartbeatTimer = window.setInterval(function () {
            for (const connection of roomConnections.values()) {
                sendToConnection(connection, { type: "heartbeat" });
            }
        }, HEARTBEAT_INTERVAL_MS);
    }

    function stopHeartbeat() {
        if (heartbeatTimer) {
            window.clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    }

    function sendJoin(connection) {
        if (!joined || !connection || !connection.roomId || !myUser) {
            return;
        }

        sendToConnection(connection, {
            type: "join",
            roomId: connection.roomId,
            userId: myUser.userId,
            userName: myUser.userName,
            color: myUser.color,
            workbookName: connection.workbookName,
        });
    }

    function syncUserProfile() {
        if (!joined || !myUser) {
            return;
        }

        for (const connection of roomConnections.values()) {
            sendToConnection(connection, {
                type: "userUpdate",
                userName: myUser.userName,
                color: myUser.color,
            });
        }
    }

    function updateLocalUserColor(user) {
        for (const connection of roomConnections.values()) {
            connection.users = connection.users.map(item => item.userId === user.userId
                ? { ...item, userName: user.userName, color: user.color }
                : item);
            connection.conflicts = connection.conflicts.map(conflict => ({
                ...conflict,
                users: conflict.users.map(item => item.userId === user.userId
                    ? { ...item, userName: user.userName, color: user.color }
                    : item),
            }));
        }

        renderActiveRoomState();
    }

    function send(data) {
        const connection = getActiveConnection();
        return sendToConnection(connection, data);
    }

    function sendToConnection(connection, data) {
        if (!connection || !connection.socket || connection.socket.readyState !== WebSocket.OPEN) {
            return false;
        }

        try {
            connection.socket.send(JSON.stringify(data));
            return true;
        } catch {
            return false;
        }
    }

    function handleServerMsg(connection, msg) {
        if (msg.type === "joined") {
            connection.users = msg.users || [];
            connection.selections.clear();

            for (const selection of msg.selections || []) {
                if (!myUser || selection.userId !== myUser.userId) {
                    connection.selections.set(selection.userId, selection);
                }
            }

            connection.conflicts = msg.conflicts || [];

            if (connection.roomId === roomId) {
                renderActiveRoomState();
                refreshHighlights();
            }

            log(`房间同步完成：${connection.workbookName}，${connection.users.length} 人在线`);
            return;
        }

        if (msg.type === "userJoined") {
            if (myUser && msg.user.userId !== myUser.userId && shouldShowUserToast("join", msg.user.userId)) {
                showToast({
                    title: `${msg.user.userName} 加入了房间`,
                    sub: msg.user.workbookName,
                    color: msg.user.color,
                    duration: 2600,
                });
                log(`${msg.user.userName} 加入了房间`);
            }
            return;
        }

        if (msg.type === "userLeft") {
            if (myUser && msg.user.userId !== myUser.userId && shouldShowUserToast("left", msg.user.userId)) {
                showToast({
                    title: `${msg.user.userName} 离开了房间`,
                    sub: msg.user.workbookName,
                    color: msg.user.color,
                    duration: 2200,
                });
                log(`${msg.user.userName} 离开了房间`);
            }
            return;
        }

        if (msg.type === "presence") {
            connection.users = msg.users || [];
            if (connection.roomId === roomId) {
                renderActiveRoomState();
            }
            return;
        }

        if (msg.type === "selection") {
            if (!myUser || msg.selection.userId !== myUser.userId) {
                connection.selections.set(msg.selection.userId, msg.selection);
                if (connection.roomId === roomId) {
                    renderActiveRoomState();
                    refreshHighlights();
                }
            }
            return;
        }

        if (msg.type === "selectionRemoved") {
            connection.selections.delete(msg.userId);
            if (connection.roomId === roomId) {
                renderActiveRoomState();
                refreshHighlights();
            }
            return;
        }

        if (msg.type === "conflicts") {
            connection.conflicts = msg.conflicts || [];
            if (connection.roomId === roomId) {
                renderActiveRoomState();
                refreshHighlights();
            }
            return;
        }

        if (msg.type === "cellChange") {
            return;
        }

        if (msg.type === "error") {
            log(`服务端提示：${msg.message}`);
        }
    }

    function renderActiveRoomState() {
        const connection = getActiveConnection();
        currentUsers = connection ? connection.users : [];

        remoteSelections.clear();
        if (connection) {
            for (const selection of connection.selections.values()) {
                remoteSelections.set(selection.userId, selection);
            }
        }

        conflicts = connection ? connection.conflicts : [];
        renderUsers(currentUsers);
        renderSelections();
        renderConflicts();
    }

    function updateServerStatus() {
        if (!joined) {
            setServerStatus("connecting", "正在自动加入协作...");
            return;
        }

        const active = getActiveConnection();
        if (!active) {
            setServerStatus("connecting", "正在识别当前表格...");
            return;
        }

        if (active.socket && active.socket.readyState === WebSocket.OPEN) {
            setServerStatus("connected", "协作服务已连接");
            return;
        }

        if (active.reconnectTimer) {
            const seconds = Math.max(1, active.reconnectRemainSeconds || Math.ceil(RECONNECT_INTERVAL_MS / 1000));
            setServerStatus("offline", `发布机已下线，${seconds}s 后重连`);
            return;
        }

        setServerStatus("connecting", "正在连接发布机...");
    }

    function startWorkbookScanner() {
        stopWorkbookScanner();
        workbookScanTimer = window.setInterval(function () {
            try {
                syncOpenWorkbooks();
            } catch (err) {
                log(`扫描打开表格失败：${err.message || err}`);
            }
        }, 2000);
    }

    function stopWorkbookScanner() {
        if (workbookScanTimer) {
            window.clearInterval(workbookScanTimer);
            workbookScanTimer = null;
        }
    }

    function shouldShowUserToast(type, userId) {
        const key = `${type}:${userId}`;
        const now = Date.now();
        const last = recentToastMap.get(key) || 0;

        if (now - last < 5000) {
            return false;
        }

        recentToastMap.set(key, now);
        return true;
    }

    function showToast(options) {
        const root = $("toastRoot");
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

        window.setTimeout(function () {
            toast.classList.add("leaving");
            window.setTimeout(function () {
                toast.remove();
            }, 220);
        }, options.duration || 2600);
    }

    function renderUsers(users) {
        const container = $("userList");
        if (!container) {
            return;
        }

        $("userCount").textContent = String(users.length);
        container.innerHTML = "";
        container.className = users.length ? "" : "empty";

        if (!users.length) {
            container.textContent = "暂无在线用户";
            return;
        }

        for (const user of users) {
            const div = document.createElement("div");
            div.className = "item";

            const dot = document.createElement("span");
            dot.className = "user-dot";
            dot.style.background = user.color;

            const text = document.createElement("div");
            const title = document.createElement("div");
            title.className = "item-title";
            title.textContent = `${user.userName}${myUser && user.userId === myUser.userId ? "（我）" : ""}`;

            const sub = document.createElement("div");
            sub.className = "item-sub";
            sub.textContent = user.lastHeartbeatAt ? `在线，最后心跳 ${formatTime(user.lastHeartbeatAt)}` : "在线";

            text.appendChild(title);
            text.appendChild(sub);
            div.appendChild(dot);
            div.appendChild(text);
            container.appendChild(div);
        }
    }

    function renderSelections() {
        const container = $("selectionList");
        if (!container) {
            return;
        }

        const selections = Array.from(remoteSelections.values());
        $("selectionCount").textContent = String(selections.length);
        container.innerHTML = "";
        container.className = selections.length ? "" : "empty";

        if (!selections.length) {
            container.textContent = "暂无远端选区";
            renderMiniMap();
            return;
        }

        for (const selection of selections) {
            const div = document.createElement("div");
            div.className = "item clickable";
            div.title = "点击跳转到该单元格";
            div.onclick = function () {
                jumpToSelection(selection);
            };

            const dot = document.createElement("span");
            dot.className = "user-dot";
            dot.style.background = selection.color;

            const text = document.createElement("div");
            const title = document.createElement("div");
            title.className = "item-title";
            title.textContent = selection.userName;

            const sub = document.createElement("div");
            sub.className = "item-sub";
            sub.textContent = formatSelectionLocation(selection);

            text.appendChild(title);
            text.appendChild(sub);
            div.appendChild(dot);
            div.appendChild(text);
            container.appendChild(div);
        }

        renderMiniMap();
    }

    function renderConflicts() {
        const container = $("conflictList");
        if (!container) {
            return;
        }

        $("conflictCount").textContent = String(conflicts.length);
        container.innerHTML = "";
        container.className = conflicts.length ? "" : "empty";

        if (!conflicts.length) {
            container.textContent = "暂无冲突";
            renderMiniMap();
            return;
        }

        for (const conflict of conflicts) {
            const div = document.createElement("div");
            div.className = "item clickable conflict-item";
            div.title = "点击跳转到冲突单元格";
            div.onclick = function () {
                jumpToConflict(conflict);
            };

            const dot = document.createElement("span");
            dot.className = "user-dot";
            dot.style.background = CONFLICT_COLOR;

            const text = document.createElement("div");
            const title = document.createElement("div");
            title.className = "item-title";
            title.textContent = formatConflictLocation(conflict);

            const sub = document.createElement("div");
            sub.className = "item-sub";
            sub.textContent = conflict.users.map(function (user) {
                return `${user.userName}: ${formatValue(user.newValue)}`;
            }).join(" / ");

            text.appendChild(title);
            text.appendChild(sub);
            div.appendChild(dot);
            div.appendChild(text);
            container.appendChild(div);
        }

        renderMiniMap();
    }

    function formatValue(value) {
        if (value === undefined) {
            return "空";
        }
        if (value === null) {
            return "空";
        }
        if (typeof value === "object") {
            try {
                return JSON.stringify(value);
            } catch {
                return String(value);
            }
        }
        return String(value);
    }

    function formatTime(value) {
        try {
            return new Date(value).toLocaleTimeString();
        } catch {
            return "-";
        }
    }

    function renderMiniMap() {
        const miniMap = $("miniMap");
        if (!miniMap) {
            return;
        }

        miniMap.innerHTML = "";
        const selections = Array.from(remoteSelections.values());

        if (!selections.length && !conflicts.length) {
            const empty = document.createElement("div");
            empty.className = "mini-map-empty";
            empty.textContent = "暂无标记";
            miniMap.appendChild(empty);
            return;
        }

        const maxRow = Math.max(1000, maxMarkerRow(selections, conflicts));
        const panelHeight = 260;

        for (const selection of selections) {
            const localAddress = resolveSelectionLocalAddress(selection);
            if (!localAddress) {
                continue;
            }

            const marker = document.createElement("div");
            marker.className = "marker";
            marker.style.background = selection.color;
            marker.style.top = `${calcMarkerTop(parseRowFromAddress(localAddress), maxRow, panelHeight)}px`;
            marker.title = `${selection.userName}: ${formatSelectionLocation(selection)}`;
            marker.onclick = function () {
                jumpToSelection(selection);
            };
            miniMap.appendChild(marker);
        }

        for (const conflict of conflicts) {
            const localAddress = resolveConflictLocalAddress(conflict);
            if (!localAddress) {
                continue;
            }

            const marker = document.createElement("div");
            marker.className = "marker";
            marker.style.background = CONFLICT_COLOR;
            marker.style.height = "6px";
            marker.style.top = `${calcMarkerTop(parseRowFromAddress(localAddress), maxRow, panelHeight)}px`;
            marker.title = `冲突: ${formatConflictLocation(conflict)}`;
            marker.onclick = function () {
                jumpToConflict(conflict);
            };
            miniMap.appendChild(marker);
        }
    }

    function maxMarkerRow(selections, conflictsList) {
        let max = 1;
        for (const selection of selections) {
            const localAddress = resolveSelectionLocalAddress(selection);
            if (localAddress) {
                max = Math.max(max, parseRowFromAddress(localAddress));
            }
        }
        for (const conflict of conflictsList) {
            const localAddress = resolveConflictLocalAddress(conflict);
            if (localAddress) {
                max = Math.max(max, parseRowFromAddress(localAddress));
            }
        }
        return max;
    }

    function calcMarkerTop(rowIndex, maxRow, panelHeight) {
        return Math.max(0, Math.min(panelHeight - 6, (rowIndex / maxRow) * panelHeight));
    }

    function formatSelectionLocation(selection) {
        const fallback = `${selection.sheetName}!${selection.address}`;

        try {
            if (selection.rowId) {
                const existsLocally = Boolean(findGameConfigRowById(selection.sheetName, selection.rowId));
                const idText = existsLocally ? `id: ${selection.rowId}` : `id: ${selection.rowId}(新增)`;
                return `${selection.sheetName} | ${idText} | ${selection.fieldName || parseColumnFromAddress(selection.address) || selection.address}`;
            }

            if (!isGameConfigSheet(selection.sheetName)) {
                return fallback;
            }

            const normalized = normalizeAddress(selection.address);
            const rowIndex = parseRowFromAddress(normalized);
            const columnName = parseColumnFromAddress(normalized);
            if (!rowIndex || !columnName) {
                return fallback;
            }

            const sheet = getApp().Worksheets.Item(selection.sheetName);
            const rowId = formatCellDisplayValue(sheet.Range(`A${rowIndex}`));
            const rowLabel = rowId ? `id: ${rowId}` : `行号: ${rowIndex}`;
            const fieldName = formatCellDisplayValue(sheet.Range(`${columnName}1`));

            if (!fieldName) {
                return fallback;
            }

            return `${selection.sheetName} | ${rowLabel} | ${fieldName}`;
        } catch {
            return fallback;
        }
    }

    function formatConflictLocation(conflict) {
        if (conflict && conflict.rowId) {
            const existsLocally = Boolean(findGameConfigRowById(conflict.sheetName, conflict.rowId));
            const idText = existsLocally ? `id: ${conflict.rowId}` : `id: ${conflict.rowId}(新增)`;
            return `${conflict.sheetName} | ${idText} | ${conflict.fieldName || parseColumnFromAddress(conflict.address) || conflict.address}`;
        }

        return `${conflict.sheetName}!${conflict.address}`;
    }

    function getGameConfigCellMeta(sheetName, address) {
        try {
            if (!isGameConfigSheet(sheetName)) {
                return {};
            }

            const normalized = normalizeAddress(address);
            const rowIndex = parseRowFromAddress(normalized);
            const columnName = parseColumnFromAddress(normalized);
            if (!rowIndex || !columnName) {
                return {};
            }

            const sheet = getApp().Worksheets.Item(sheetName);
            const rowId = formatCellDisplayValue(sheet.Range(`A${rowIndex}`));
            const fieldName = formatCellDisplayValue(sheet.Range(`${columnName}1`));

            return {
                ...(rowId ? { rowId } : {}),
                ...(fieldName ? { fieldName } : {}),
            };
        } catch {
            return {};
        }
    }

    function resolveSelectionLocalAddress(selection) {
        if (!selection || !selection.sheetName || !selection.address) {
            return "";
        }

        if (selection.rowId && selection.fieldName) {
            return resolveGameConfigAddress(selection.sheetName, selection.rowId, selection.fieldName);
        }

        return normalizeAddress(selection.address);
    }

    function resolveConflictLocalAddress(conflict) {
        if (!conflict || !conflict.sheetName || !conflict.address) {
            return "";
        }

        if (conflict.rowId && conflict.fieldName) {
            return resolveGameConfigAddress(conflict.sheetName, conflict.rowId, conflict.fieldName);
        }

        return normalizeAddress(conflict.address);
    }

    function resolveGameConfigAddress(sheetName, rowId, fieldName) {
        try {
            const rowIndex = findGameConfigRowById(sheetName, rowId);
            const columnName = findGameConfigColumnByField(sheetName, fieldName);
            if (!rowIndex || !columnName) {
                return "";
            }

            return `${columnName}${rowIndex}`;
        } catch {
            return "";
        }
    }

    function findGameConfigRowById(sheetName, rowId) {
        const target = String(rowId || "").trim();
        if (!target || !isGameConfigSheet(sheetName)) {
            return 0;
        }

        try {
            const sheet = getApp().Worksheets.Item(sheetName);
            const usedRange = getSheetUsedRange(sheet);
            const rowCount = Math.max(1, getRangeCollectionCount(usedRange, "Rows") || 1000);

            for (let row = 2; row <= rowCount; row++) {
                if (formatCellDisplayValue(sheet.Range(`A${row}`)) === target) {
                    return row;
                }
            }
        } catch {
            // ignore
        }

        return 0;
    }

    function findGameConfigColumnByField(sheetName, fieldName) {
        const target = String(fieldName || "").trim();
        if (!target || !isGameConfigSheet(sheetName)) {
            return "";
        }

        try {
            const sheet = getApp().Worksheets.Item(sheetName);
            const usedRange = getSheetUsedRange(sheet);
            const colCount = Math.max(1, getRangeCollectionCount(usedRange, "Columns") || 256);

            for (let col = 1; col <= colCount; col++) {
                const columnName = columnIndexToName(col);
                if (formatCellDisplayValue(sheet.Range(`${columnName}1`)) === target) {
                    return columnName;
                }
            }
        } catch {
            // ignore
        }

        return "";
    }

    function getSheetUsedRange(sheet) {
        try {
            if (sheet.UsedRange) {
                return typeof sheet.UsedRange === "function" ? sheet.UsedRange() : sheet.UsedRange;
            }
        } catch {
            // ignore
        }

        return null;
    }

    function getRangeCollectionCount(range, propertyName) {
        try {
            const collection = readRangeDisplayProperty(range, propertyName);
            const count = readRangeDisplayProperty(collection, "Count");
            const number = Number(count);
            return Number.isFinite(number) ? number : 0;
        } catch {
            return 0;
        }
    }

    function columnIndexToName(index) {
        let value = Number(index);
        let name = "";

        while (value > 0) {
            const remainder = (value - 1) % 26;
            name = String.fromCharCode(65 + remainder) + name;
            value = Math.floor((value - 1) / 26);
        }

        return name;
    }

    function isGameConfigSheet(sheetName) {
        try {
            const sheet = getApp().Worksheets.Item(sheetName);
            return String(formatCellDisplayValue(sheet.Range("A1"))).trim().toLowerCase() === "id";
        } catch {
            return false;
        }
    }

    function formatCellDisplayValue(range) {
        if (!range) {
            return "";
        }

        try {
            const text = readRangeDisplayProperty(range, "Text");
            if (isUsableCellDisplayValue(text)) {
                return String(text).trim();
            }
        } catch {
            // ignore
        }

        const value = readRangeDisplayProperty(range, "Value");
        if (isUsableCellDisplayValue(value)) {
            return String(value).trim();
        }

        const formula = readRangeDisplayProperty(range, "Formula");
        if (isUsableCellDisplayValue(formula)) {
            return String(formula).trim();
        }

        return "";
    }

    function readRangeDisplayProperty(range, propertyName) {
        const value = range[propertyName];
        if (typeof value === "function") {
            return value.call(range);
        }

        return value;
    }

    function isUsableCellDisplayValue(value) {
        if (value === undefined || value === null || typeof value === "function") {
            return false;
        }

        const text = String(value).trim();
        return text !== "" && !/^function\s+\w*\s*\(\)\s*\{\s*\[native code\]\s*\}$/i.test(text);
    }

    function parseRowFromAddress(address) {
        const match = String(address).match(/\d+/);
        return match ? Number(match[0]) : 1;
    }

    function parseColumnFromAddress(address) {
        const match = String(address).match(/[A-Z]+/i);
        return match ? match[0].toUpperCase() : "";
    }

    function normalizeAddress(address) {
        const text = String(address || "").trim();
        if (/^function\s+Address\s*\(/i.test(text)) {
            return "";
        }

        return text
            .replace(/\$/g, "")
            .replace(/^.*!/, "")
            .trim();
    }

    function isManageableAddress(address) {
        const normalized = normalizeAddress(address);
        if (!normalized) {
            return false;
        }

        if (!normalized.includes(":")) {
            return true;
        }

        const parts = normalized.split(":");
        return parts.length === 2 && parts[0] === parts[1];
    }

    function getSheetName(sheet) {
        try {
            if (sheet && sheet.Name) {
                return String(sheet.Name);
            }
        } catch {
            // ignore
        }

        try {
            return String(getApp().ActiveSheet.Name);
        } catch {
            return "Sheet1";
        }
    }

    function getRangeAddress(range) {
        if (!range) {
            return "";
        }

        try {
            const address = range.Address;
            if (typeof address === "function") {
                try {
                    const normalized = normalizeAddress(address.call(range));
                    if (normalized) {
                        return normalized;
                    }
                } catch {
                    // Try the WPS/Excel method signature below.
                }

                return normalizeAddress(address.call(range, false, false));
            }

            return normalizeAddress(address);
        } catch {
            return "";
        }
    }

    function getRangeValue(range) {
        try {
            return range.Value;
        } catch {
            try {
                return range.Formula;
            } catch {
                return undefined;
            }
        }
    }

    function bindWpsEvents() {
        if (eventsBound) {
            return;
        }

        const app = getApp();
        if (!app.ApiEvent) {
            log("当前 WPS 不支持 ApiEvent，无法同步选区和修改。");
            return;
        }

        try {
            app.ApiEvent.AddApiEventListener("SheetSelectionChange", onSheetSelectionChange);
            app.ApiEvent.AddApiEventListener("SheetChange", onSheetChange);
            app.ApiEvent.AddApiEventListener("WorkbookActivate", onWorkbookListChanged);
            app.ApiEvent.AddApiEventListener("WorkbookOpen", onWorkbookListChanged);
            app.ApiEvent.AddApiEventListener("NewWorkbook", onWorkbookListChanged);
            app.ApiEvent.AddApiEventListener("WorkbookBeforeClose", onWorkbookBeforeClose);
            eventsBound = true;
            log("已绑定 WPS 工作簿、选区和修改事件");
        } catch (err) {
            log(`绑定 WPS 事件失败：${err.message || err}`);
        }
    }

    function unbindWpsEvents() {
        if (!eventsBound) {
            return;
        }

        try {
            const app = getApp();
            app.ApiEvent.RemoveApiEventListener("SheetSelectionChange", onSheetSelectionChange);
            app.ApiEvent.RemoveApiEventListener("SheetChange", onSheetChange);
            app.ApiEvent.RemoveApiEventListener("WorkbookActivate", onWorkbookListChanged);
            app.ApiEvent.RemoveApiEventListener("WorkbookOpen", onWorkbookListChanged);
            app.ApiEvent.RemoveApiEventListener("NewWorkbook", onWorkbookListChanged);
            app.ApiEvent.RemoveApiEventListener("WorkbookBeforeClose", onWorkbookBeforeClose);
        } catch {
            // ignore
        }

        eventsBound = false;
    }

    function onSheetSelectionChange(sheet, range) {
        if (!joined) {
            return;
        }

        if (selectionTimer) {
            window.clearTimeout(selectionTimer);
            selectionTimer = null;
        }

        selectionTimer = window.setTimeout(function () {
            try {
                syncOpenWorkbooks();
            } catch (err) {
                log(`同步当前表格失败：${err.message || err}`);
            }

            const address = getRangeAddress(range);
            if (!isManageableAddress(address)) {
                return;
            }

            const sheetName = getSheetName(sheet);
            const meta = getGameConfigCellMeta(sheetName, address);
            send({
                type: "selection",
                sheetName,
                address,
                ...meta,
            });
        }, SELECTION_THROTTLE_MS);
    }

    function onSheetChange(sheet, range) {
        if (!joined) {
            return;
        }

        try {
            syncOpenWorkbooks();
        } catch (err) {
            log(`同步当前表格失败：${err.message || err}`);
        }

        const address = getRangeAddress(range);
        if (!isManageableAddress(address)) {
            log(`跳过大范围修改：${address}`);
            return;
        }

        const sheetName = getSheetName(sheet);
        const meta = getGameConfigCellMeta(sheetName, address);

        send({
            type: "cellChange",
            sheetName,
            address,
            ...meta,
            newValue: getRangeValue(range),
        });
    }

    function onWorkbookBeforeClose() {
        onWorkbookListChanged();
    }

    function onWorkbookListChanged() {
        if (!joined) {
            return;
        }

        window.setTimeout(function () {
            try {
                syncOpenWorkbooks();
            } catch (err) {
                log(`同步表格房间失败：${err.message || err}`);
            }
        }, 100);
    }

    async function jumpToCell(sheetName, address) {
        try {
            const app = getApp();
            const sheet = app.Worksheets.Item(sheetName);
            sheet.Activate();
            const range = sheet.Range(address);
            range.Select();
        } catch (err) {
            log(`跳转失败：${sheetName}!${address}`);
            console.error(err);
        }
    }

    function jumpToSelection(selection) {
        const address = resolveSelectionLocalAddress(selection);
        if (!address) {
            log(`远端选区在本地不存在：${formatSelectionLocation(selection)}`);
            return;
        }

        jumpToCell(selection.sheetName, address);
    }

    function jumpToConflict(conflict) {
        const address = resolveConflictLocalAddress(conflict);
        if (!address) {
            log(`冲突单元格在本地不存在：${formatConflictLocation(conflict)}`);
            return;
        }

        jumpToCell(conflict.sheetName, address);
    }

    async function refreshHighlights() {
        try {
            await clearOldHighlights();

            for (const selection of remoteSelections.values()) {
                await highlightSelectionCell(selection);
            }

            for (const conflict of conflicts) {
                await highlightConflictCell(conflict);
            }
        } catch (err) {
            console.error("refreshHighlights failed", err);
            log("刷新高亮失败，请在真实 WPS 环境中检查 API 兼容性。");
        }
    }

    async function highlightSelectionCell(selection) {
        const address = resolveSelectionLocalAddress(selection);
        if (!isManageableAddress(address)) {
            return;
        }

        const app = getApp();
        const sheet = app.Worksheets.Item(selection.sheetName);
        const range = sheet.Range(address);
        const key = `${selection.sheetName}!${address}`;

        const state = rememberHighlightState(key, range);

        try {
            applyRangeBorder(range, selection.color, XL_BORDER_WEIGHT_MEDIUM);
            addSelectionLabel(sheet, range, selection.userName, selection.color, state);
        } catch (err) {
            console.error("highlightSelectionCell failed", err);
        }
    }

    async function highlightConflictCell(conflict) {
        const address = resolveConflictLocalAddress(conflict);
        if (!isManageableAddress(address)) {
            return;
        }

        const app = getApp();
        const sheet = app.Worksheets.Item(conflict.sheetName);
        const range = sheet.Range(address);
        const key = `${conflict.sheetName}!${address}`;

        rememberHighlightState(key, range);

        try {
            range.Interior.Pattern = XL_PATTERN_SOLID;
            range.Interior.Color = cssHexToWpsColor(CONFLICT_FILL_COLOR);
            applyRangeBorder(range, CONFLICT_BORDER_COLOR, XL_BORDER_WEIGHT_MEDIUM);
        } catch (err) {
            console.error("highlightConflictCell failed", err);
        }
    }

    async function clearOldHighlights() {
        const app = getApp();

        for (const entry of originalHighlights.entries()) {
            const key = entry[0];
            const state = entry[1];
            const sep = key.lastIndexOf("!");
            const sheetName = key.slice(0, sep);
            const address = key.slice(sep + 1);

            if (!sheetName || !address) {
                continue;
            }

            try {
                const sheet = app.Worksheets.Item(sheetName);
                const range = sheet.Range(address);
                restoreRangeHighlight(range, state);
            } catch {
                // ignore; sheet or cell may have disappeared
            }
        }

        originalHighlights.clear();
    }

    function rememberHighlightState(key, range) {
        if (originalHighlights.has(key)) {
            return originalHighlights.get(key);
        }

        const state = captureRangeHighlight(range);
        originalHighlights.set(key, state);
        return state;
    }

    function captureRangeHighlight(range) {
        const state = {
            interior: {},
            borders: [],
            labels: [],
        };

        try {
            state.interior = captureInteriorState(range.Interior);
        } catch {
            // ignore
        }

        for (const index of BORDER_EDGE_INDEXES) {
            const border = getRangeBorder(range, index);
            state.borders.push({
                index,
                lineStyle: readWpsProperty(border, "LineStyle"),
                weight: readWpsProperty(border, "Weight"),
                color: readWpsProperty(border, "Color"),
                colorIndex: readWpsProperty(border, "ColorIndex"),
            });
        }

        return state;
    }

    function captureInteriorState(interior) {
        return {
            color: readWpsProperty(interior, "Color"),
            colorIndex: readWpsProperty(interior, "ColorIndex"),
            pattern: readWpsProperty(interior, "Pattern"),
        };
    }

    function restoreRangeHighlight(range, state) {
        if (!state) {
            return;
        }

        deleteSelectionLabels(state);

        try {
            restoreInterior(range.Interior, state.interior);
        } catch {
            // ignore
        }

        for (const borderState of state.borders || []) {
            const border = getRangeBorder(range, borderState.index);
            restoreBorder(border, borderState);
        }
    }

    function restoreInterior(interior, state) {
        if (!interior || !state) {
            return;
        }

        if (state.colorIndex === XL_COLOR_INDEX_NONE) {
            writeWpsProperty(interior, "ColorIndex", XL_COLOR_INDEX_NONE);
            return;
        }

        writeWpsProperty(interior, "Pattern", state.pattern);
        writeWpsProperty(interior, "ColorIndex", state.colorIndex);
        writeWpsProperty(interior, "Color", state.color);
    }

    function restoreBorder(border, state) {
        if (!border || !state) {
            return;
        }

        writeWpsProperty(border, "LineStyle", state.lineStyle);

        if (state.lineStyle === XL_LINE_STYLE_NONE) {
            return;
        }

        writeWpsProperty(border, "Weight", state.weight);
        writeWpsProperty(border, "ColorIndex", state.colorIndex);
        writeWpsProperty(border, "Color", state.color);
    }

    function addSelectionLabel(sheet, range, userName, color, state) {
        if (!state || !userName) {
            return;
        }

        const shape = createSelectionLabelShape(sheet, range, userName, color);
        if (shape) {
            state.labels.push(shape);
        }
    }

    function createSelectionLabelShape(sheet, range, userName, color) {
        try {
            const shapes = sheet.Shapes;
            if (!shapes || typeof shapes.AddTextbox !== "function") {
                return null;
            }

            const text = compactLabelText(userName);
            const left = readRangeNumberProperty(range, "Left");
            const top = readRangeNumberProperty(range, "Top");
            const cellWidth = readRangeNumberProperty(range, "Width");
            if (left === null || top === null || cellWidth === null) {
                return null;
            }

            const labelHeight = calcSelectionLabelHeight(range);
            const labelLeft = left + 1;
            const labelTop = top + 0.5;
            const availableWidth = Math.max(SELECTION_LABEL_MIN_WIDTH, cellWidth - 2);
            const width = calcSelectionLabelWidth(text, availableWidth);
            const shape = shapes.AddTextbox(MSO_TEXT_ORIENTATION_HORIZONTAL, labelLeft, labelTop, width, labelHeight);
            const wpsColor = cssHexToWpsColor(color);

            writeWpsProperty(shape, "Name", `${SELECTION_LABEL_PREFIX}${Date.now()}`);
            writeWpsProperty(shape, "Left", labelLeft);
            writeWpsProperty(shape, "Top", labelTop);
            writeWpsProperty(shape, "Width", width);
            writeWpsProperty(shape, "Height", labelHeight);
            setShapeText(shape, text);
            setShapeFill(shape, wpsColor);
            setShapeLine(shape, wpsColor);

            return shape;
        } catch (err) {
            console.error("createSelectionLabelShape failed", err);
            return null;
        }
    }

    function calcSelectionLabelHeight(range) {
        const cellHeight = readRangeNumberProperty(range, "Height") || SELECTION_LABEL_MAX_HEIGHT * 3;
        const maxHeight = Math.max(1, cellHeight / 3);
        return Math.min(SELECTION_LABEL_MAX_HEIGHT, Math.max(SELECTION_LABEL_MIN_HEIGHT, maxHeight));
    }

    function readRangeNumberProperty(range, propertyName) {
        try {
            const value = readRangeDisplayProperty(range, propertyName);
            const number = Number(value);
            return Number.isFinite(number) ? number : null;
        } catch {
            return null;
        }
    }

    function calcSelectionLabelWidth(text, cellWidth) {
        let estimate = 4;

        for (const char of String(text || "")) {
            estimate += /[ -~]/.test(char) ? 2.2 : 4.8;
        }

        return Math.min(SELECTION_LABEL_MAX_WIDTH, Math.max(SELECTION_LABEL_MIN_WIDTH, Math.min(cellWidth, estimate)));
    }

    function compactLabelText(value) {
        const text = String(value || "").trim();
        if (text.length <= 8) {
            return text;
        }

        return `${text.slice(0, 7)}...`;
    }

    function setShapeText(shape, text) {
        try {
            if (shape.TextFrame2 && shape.TextFrame2.TextRange) {
                shape.TextFrame2.TextRange.Text = text;
                setTextRangeFont(shape.TextFrame2.TextRange.Font);
                if (shape.TextFrame2.TextRange.ParagraphFormat) {
                    shape.TextFrame2.TextRange.ParagraphFormat.Alignment = MSO_ALIGN_CENTER;
                }
                writeWpsProperty(shape.TextFrame2, "VerticalAnchor", MSO_ANCHOR_MIDDLE);
                writeWpsProperty(shape.TextFrame2, "MarginLeft", 0);
                writeWpsProperty(shape.TextFrame2, "MarginRight", 0);
                writeWpsProperty(shape.TextFrame2, "MarginTop", 0);
                writeWpsProperty(shape.TextFrame2, "MarginBottom", 0);
            }
        } catch {
            // ignore
        }

        try {
            if (shape.TextFrame) {
                const characters = typeof shape.TextFrame.Characters === "function"
                    ? shape.TextFrame.Characters()
                    : shape.TextFrame.Characters;
                if (characters) {
                    characters.Text = text;
                    setTextRangeFont(characters.Font);
                }
                writeWpsProperty(shape.TextFrame, "HorizontalAlignment", XL_H_ALIGN_CENTER);
                writeWpsProperty(shape.TextFrame, "VerticalAlignment", XL_V_ALIGN_CENTER);
                writeWpsProperty(shape.TextFrame, "MarginLeft", 0);
                writeWpsProperty(shape.TextFrame, "MarginRight", 0);
                writeWpsProperty(shape.TextFrame, "MarginTop", 0);
                writeWpsProperty(shape.TextFrame, "MarginBottom", 0);
            }
        } catch {
            // ignore
        }
    }

    function setTextRangeFont(font) {
        if (!font) {
            return;
        }

        writeWpsProperty(font, "Size", SELECTION_LABEL_FONT_SIZE);
        writeWpsProperty(font, "Bold", true);
        writeWpsProperty(font, "Color", cssHexToWpsColor("#ffffff"));
    }

    function setShapeFill(shape, color) {
        try {
            if (shape.Fill) {
                if (typeof shape.Fill.Visible !== "undefined") {
                    shape.Fill.Visible = true;
                }
                if (shape.Fill.ForeColor) {
                    shape.Fill.ForeColor.RGB = color;
                } else {
                    shape.Fill.Color = color;
                }
            }
        } catch {
            // ignore
        }
    }

    function setShapeLine(shape, color) {
        try {
            if (shape.Line) {
                if (shape.Line.ForeColor) {
                    shape.Line.ForeColor.RGB = color;
                } else {
                    shape.Line.Color = color;
                }
                writeWpsProperty(shape.Line, "Weight", 0.75);
            }
        } catch {
            // ignore
        }
    }

    function deleteSelectionLabels(state) {
        for (const shape of state.labels || []) {
            try {
                if (shape && typeof shape.Delete === "function") {
                    shape.Delete();
                }
            } catch {
                // ignore
            }
        }

        state.labels = [];
    }

    function applyRangeBorder(range, color, weight) {
        const wpsColor = cssHexToWpsColor(color);
        const borderWeight = weight || XL_BORDER_WEIGHT_THIN;

        for (const index of BORDER_EDGE_INDEXES) {
            const border = getRangeBorder(range, index);
            if (!border) {
                continue;
            }

            border.LineStyle = XL_LINE_STYLE_CONTINUOUS;
            border.Weight = borderWeight;
            border.Color = wpsColor;
        }
    }

    function getRangeBorder(range, index) {
        try {
            const borders = range.Borders;
            if (!borders) {
                return null;
            }

            if (typeof borders.Item === "function") {
                return borders.Item(index);
            }

            if (typeof borders === "function") {
                return borders(index);
            }
        } catch {
            // ignore
        }

        return null;
    }

    function readWpsProperty(target, propertyName) {
        if (!target) {
            return undefined;
        }

        try {
            return target[propertyName];
        } catch {
            return undefined;
        }
    }

    function writeWpsProperty(target, propertyName, value) {
        if (!target || value === undefined || value === null) {
            return;
        }

        try {
            target[propertyName] = value;
        } catch {
            // ignore
        }
    }

    function cssHexToWpsColor(color) {
        let normalized = String(color || "").replace("#", "").trim();
        if (!/^[0-9a-f]{6}$/i.test(normalized)) {
            normalized = USER_COLORS[0].replace("#", "");
        }

        const red = parseInt(normalized.slice(0, 2), 16);
        const green = parseInt(normalized.slice(2, 4), 16);
        const blue = parseInt(normalized.slice(4, 6), 16);
        return red + green * 256 + blue * 65536;
    }

    function initControls() {
        myUser = loadUser();
        syncColorDraftFromUser(myUser);
        renderUserColorControls();
        const settingsSaved = hasSavedSettings();

        $("reconnectBtn").addEventListener("click", function () {
            if (!hasSavedSettings()) {
                openSettingsModal(true);
                return;
            }
            if (joined) {
                connectServer();
            } else {
                autoJoinRoom();
            }
        });

        const serverUrlInput = $("serverUrlInput");
        const repoUrlInput = $("repoUrlInput");
        const repoRootInput = $("repoRootInput");
        const userNameInput = $("userNameInput");
        const userColorInput = $("userColorInput");
        const userColorAutoBtn = $("userColorAutoBtn");

        $("openSettingsBtn").addEventListener("click", function () {
            openSettingsModal(false);
        });
        $("closeSettingsBtn").addEventListener("click", closeSettingsModal);
        $("saveSettingsBtn").addEventListener("click", saveSettings);
        $("settingsModal").addEventListener("click", function (event) {
            if (event.target === $("settingsModal")) {
                closeSettingsModal();
            }
        });

        bindCommitOnEnter(serverUrlInput, saveSettings);
        bindCommitOnEnter(repoUrlInput, saveSettings);
        bindCommitOnEnter(repoRootInput, saveSettings);
        bindCommitOnEnter(userNameInput, saveSettings);

        userColorInput.addEventListener("input", function () {
            updateCurrentUserColor("custom", userColorInput.value);
        });
        userColorInput.addEventListener("change", function () {
            updateCurrentUserColor("custom", userColorInput.value);
        });
        userColorAutoBtn.addEventListener("click", function () {
            updateCurrentUserColor("auto", "");
        });

        window.addEventListener("beforeunload", leaveRoom);
        window.addEventListener("unload", leaveRoom);

        setServerStatus("connecting", settingsSaved ? "正在自动加入协作..." : "请先完成协作设置");
        renderUsers([]);
        renderSelections();
        renderConflicts();

        if (settingsSaved) {
            window.setTimeout(autoJoinRoom, AUTO_JOIN_DELAY_MS);
        } else {
            window.setTimeout(function () {
                openSettingsModal(true);
            }, 0);
        }
    }

    function autoJoinRoom() {
        if (!hasSavedSettings()) {
            setServerStatus("connecting", "请先完成协作设置");
            openSettingsModal(true);
            return;
        }

        if (joined) {
            stopAutoJoinRetry();
            return;
        }

        joinRoom().then(function () {
            stopAutoJoinRetry();
            log("已自动加入当前表格房间");
        }).catch(function (err) {
            const message = err.message || String(err);
            logAutoJoinMessage(`自动加入未完成：${message}`);

            startAutoJoinRetry();
        });
    }

    function startAutoJoinRetry() {
        if (autoJoinTimer || joined) {
            return;
        }

        autoJoinTimer = window.setInterval(function () {
            autoJoinRoom();
        }, AUTO_JOIN_RETRY_MS);
    }

    function stopAutoJoinRetry() {
        if (autoJoinTimer) {
            window.clearInterval(autoJoinTimer);
            autoJoinTimer = null;
        }
    }

    function logAutoJoinMessage(message) {
        if (message === lastAutoJoinMessage) {
            return;
        }

        lastAutoJoinMessage = message;
        log(message);
    }

    window.addEventListener("DOMContentLoaded", initControls);
})();
