export function renderDashboardHtml() {
    return `<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>表里有人 dashboard</title>
    <style>
        * { box-sizing: border-box; }
        body {
            display: flex;
            flex-direction: column;
            min-height: 100vh;
            margin: 0;
            background: #f6f8fb;
            color: #172033;
            font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
            font-size: 14px;
            line-height: 1.45;
        }
        header {
            position: sticky;
            top: 0;
            z-index: 2;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 16px 24px;
            background: rgba(255, 255, 255, 0.94);
            border-bottom: 1px solid #dbe3ef;
            backdrop-filter: blur(10px);
        }
        h1 {
            margin: 0;
            font-size: 20px;
            letter-spacing: 0;
        }
        .sub {
            color: #667085;
            font-size: 12px;
        }
        .header-actions {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
            justify-content: flex-end;
        }
        .header-link {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            min-height: 34px;
            padding: 0 12px;
            border: 1px solid #d0d7de;
            border-radius: 6px;
            background: #fff;
            color: #172033;
            font-weight: 700;
            text-decoration: none;
            white-space: nowrap;
        }
        .header-link:hover {
            border-color: #98a2b3;
            background: #f8fafc;
        }
        .header-link svg {
            flex: none;
        }
        .modal-backdrop {
            position: fixed;
            inset: 0;
            z-index: 10;
            display: none;
            align-items: center;
            justify-content: center;
            padding: 20px;
            background: rgba(15, 23, 42, 0.48);
        }
        .modal-backdrop.show {
            display: flex;
        }
        .modal {
            width: min(560px, 100%);
            border: 1px solid #dbe3ef;
            border-radius: 12px;
            background: #fff;
            box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
        }
        .modal-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
            padding: 18px 20px 10px;
        }
        .modal-title {
            margin: 0;
            font-size: 18px;
        }
        .modal-close {
            border: 0;
            background: transparent;
            color: #667085;
            cursor: pointer;
            font-size: 24px;
            line-height: 1;
        }
        .modal-body {
            padding: 0 20px 20px;
        }
        .modal-body p {
            margin: 8px 0;
        }
        .command-box {
            position: relative;
            margin: 12px 0;
            border: 1px solid #d0d7de;
            border-radius: 8px;
            background: #0f172a;
        }
        .command-box pre {
            margin: 0;
            overflow-x: auto;
            padding: 14px 86px 14px 14px;
            color: #e2e8f0;
            font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
            user-select: text;
            white-space: pre;
        }
        .copy-button {
            position: absolute;
            top: 10px;
            right: 10px;
            min-height: 28px;
            padding: 0 10px;
            border: 1px solid rgba(226, 232, 240, 0.32);
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.1);
            color: #f8fafc;
            cursor: pointer;
            font-weight: 700;
        }
        .modal-actions {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
            margin-top: 14px;
        }
        .primary-link {
            border-color: #2563eb;
            background: #2563eb;
            color: #fff;
        }
        .primary-link:hover {
            border-color: #1d4ed8;
            background: #1d4ed8;
        }
        main {
            flex: 1;
            width: 100%;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px 24px 28px;
        }
        .dashboard-footer {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            width: 100%;
            margin: 0 auto;
            padding: 14px 24px 18px;
            color: #667085;
            font-size: 12px;
            text-align: center;
        }
        .dashboard-footer .sub {
            color: inherit;
        }
        .footer-separator {
            width: 3px;
            height: 3px;
            border-radius: 50%;
            background: #98a2b3;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 12px;
            margin-bottom: 16px;
        }
        .stat, .panel {
            border: 1px solid #dbe3ef;
            border-radius: 8px;
            background: #fff;
        }
        .stat {
            padding: 14px 16px;
        }
        .stat-label {
            color: #667085;
            font-size: 12px;
        }
        .stat-value {
            margin-top: 4px;
            font-size: 26px;
            font-weight: 800;
        }
        .grid {
            display: grid;
            grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
            gap: 16px;
            align-items: start;
        }
        .panel {
            overflow: hidden;
        }
        .panel-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 12px 14px;
            border-bottom: 1px solid #edf1f7;
            font-weight: 800;
        }
        .contrib-tabs {
            display: inline-flex;
            gap: 6px;
        }
        .contrib-tab {
            min-height: 24px;
            padding: 0 9px;
            border: 1px solid #d0d7de;
            border-radius: 999px;
            background: #fff;
            color: #667085;
            cursor: pointer;
            font-size: 12px;
            font-weight: 700;
            line-height: 1;
        }
        .contrib-tab.is-active {
            border-color: #2563eb;
            background: #eff6ff;
            color: #1d4ed8;
        }
        .panel-body {
            padding: 12px 14px;
        }
        .room {
            padding: 12px;
            border: 1px solid #edf1f7;
            border-radius: 8px;
            margin-bottom: 10px;
            background: #fbfcfe;
        }
        .room-head {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 8px;
        }
        .room-name {
            font-weight: 800;
            word-break: break-all;
        }
        .room-id {
            margin-top: 2px;
            color: #667085;
            font-size: 12px;
            word-break: break-all;
        }
        .pill {
            display: inline-flex;
            align-items: center;
            height: 22px;
            padding: 0 8px;
            border-radius: 999px;
            background: #edf1f7;
            color: #475467;
            font-size: 12px;
            white-space: nowrap;
        }
        .user-row, .contrib-row {
            display: grid;
            grid-template-columns: 10px 1fr auto;
            gap: 8px;
            align-items: center;
            padding: 7px 0;
            border-top: 1px solid #edf1f7;
        }
        .user-row:first-child, .contrib-row:first-child {
            border-top: 0;
        }
        .dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
        }
        .name {
            font-weight: 700;
            word-break: break-word;
        }
        .meta {
            color: #667085;
            font-size: 12px;
            word-break: break-all;
        }
        .bar {
            height: 6px;
            margin-top: 5px;
            overflow: hidden;
            border-radius: 999px;
            background: #edf1f7;
        }
        .bar > span {
            display: block;
            height: 100%;
            background: #2563eb;
        }
        .empty {
            padding: 28px 12px;
            color: #98a2b3;
            text-align: center;
        }
        @media (max-width: 860px) {
            header { align-items: flex-start; flex-direction: column; }
            .header-actions { justify-content: flex-start; }
            .dashboard-footer { flex-wrap: wrap; }
            .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <header>
        <div>
            <h1>表里有人 Dashboard</h1>
            <div class="sub">看看表里谁在配，谁在改，谁在和你撞格子</div>
        </div>
        <nav class="header-actions" aria-label="页面操作">
            <a href="https://github.com/tadazly/wps-anybody-here" target="_blank" rel="noopener noreferrer" class="header-link navbar__item navbar__link">GitHub<svg width="13.5" height="13.5" aria-hidden="true" viewBox="0 0 24 24" class="iconExternalLink_nPIU"><path fill="currentColor" d="M21 13v10h-21v-19h12v2h-10v15h17v-8h2zm3-12h-10.988l4.035 4-6.977 7.07 2.828 2.828 6.977-7.07 4.125 4.172v-11z"></path></svg></a>
            <a href="/addin/publish.html" id="installLink" class="header-link">安装插件</a>
        </nav>
    </header>
    <main>
        <section class="stats">
            <div class="stat"><div class="stat-label">在线用户</div><div id="clientCount" class="stat-value">0</div></div>
            <div class="stat"><div class="stat-label">打开表格</div><div id="roomCount" class="stat-value">0</div></div>
            <div class="stat"><div class="stat-label">本次编辑</div><div id="editCount" class="stat-value">0</div></div>
            <div class="stat"><div class="stat-label">冲突单元格</div><div id="conflictCount" class="stat-value">0</div></div>
        </section>
        <section class="grid">
            <div class="panel">
                <div class="panel-title">
                    <span>打开的表格</span>
                    <span id="roomTitleCount" class="pill">0 个</span>
                </div>
                <div id="rooms" class="panel-body"></div>
            </div>
            <div class="panel">
                <div class="panel-title">
                    <span>编辑贡献排行榜（Top 10）</span>
                    <div class="contrib-tabs" role="tablist" aria-label="编辑贡献时间范围">
                        <button type="button" class="contrib-tab is-active" data-window="recent7Days">最近7天</button>
                        <button type="button" class="contrib-tab" data-window="recent30Days">最近30天</button>
                    </div>
                </div>
                <div id="contributions" class="panel-body"></div>
            </div>
        </section>
    </main>
    <footer class="dashboard-footer">
        <div class="sub">Copyright © 2026 Tadazly.</div>
        <span class="footer-separator" aria-hidden="true"></span>
        <div id="updatedAt" class="sub">等待数据...</div>
    </footer>
    <div id="macInstallModal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="macInstallTitle">
        <div class="modal">
            <div class="modal-head">
                <div>
                    <h2 id="macInstallTitle" class="modal-title">Mac 手动安装插件</h2>
                    <div class="sub">WPS Mac 在线安装加载项有兼容问题，需要下载脚本后手动执行。</div>
                </div>
                <button type="button" id="macInstallClose" class="modal-close" aria-label="关闭">×</button>
            </div>
            <div class="modal-body">
                <p>1. 先点击下面的“下载 Mac 安装脚本”。</p>
                <p>2. 打开终端，进入下载目录后执行：</p>
                <div class="command-box">
                    <pre id="macInstallCommand">cd ~/Downloads
chmod +x mac-install.sh
./mac-install.sh</pre>
                    <button type="button" id="copyMacInstallCommand" class="copy-button">复制</button>
                </div>
                <p class="sub">执行完成后，请完全退出 WPS（Dock 右键退出），再重新打开生效。</p>
                <div class="modal-actions">
                    <a href="/install/mac-install.sh" download="mac-install.sh" class="header-link primary-link">下载 Mac 安装脚本</a>
                    <button type="button" id="macInstallCancel" class="header-link">稍后再说</button>
                </div>
            </div>
        </div>
    </div>
    <script>
        const fmtTime = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const contributionLabels = {
            recent7Days: "最近7天",
            recent30Days: "最近30天",
        };
        let activeContributionWindow = "recent7Days";
        let contributionRankings = {
            recent7Days: [],
            recent30Days: [],
        };

        function escapeHtml(value) {
            return String(value ?? "").replace(/[&<>"']/g, ch => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            }[ch]));
        }

        function time(value) {
            return value ? fmtTime.format(new Date(value)) : "-";
        }

        function isLocalAbsolutePath(value) {
            const text = String(value ?? "").replace(/\\\\/g, "/");
            return /^[a-z]:\\//i.test(text) || text.startsWith("//") || text.startsWith("/");
        }

        function roomFilePath(roomId) {
            const text = String(roomId ?? "");
            const sep = text.indexOf("::");
            return sep >= 0 ? text.slice(sep + 2) : text;
        }

        function roomPathHtml(room) {
            const roomId = roomFilePath(room.roomId);
            const workbookName = String(room.workbookName ?? "");
            if (!roomId || isLocalAbsolutePath(roomId) || roomId.toLowerCase() === workbookName.toLowerCase()) {
                return "";
            }

            return \`<div class="room-id" title="\${escapeHtml(roomId)}">\${escapeHtml(roomId)}</div>\`;
        }

        function renderUsers(users) {
            return users.map(user => \`
                <div class="user-row">
                    <span class="dot" style="background:\${escapeHtml(user.color)}"></span>
                    <div>
                        <div class="name">\${escapeHtml(user.userName)}</div>
                        <div class="meta">加入 \${time(user.joinedAt)}，心跳 \${time(user.lastHeartbeatAt)}</div>
                    </div>
                    <span class="pill">\${escapeHtml(user.selection ? user.selection.sheetName + "!" + user.selection.address : "未选区")}</span>
                </div>
            \`).join("");
        }

        function renderRooms(rooms) {
            const root = document.getElementById("rooms");
            document.getElementById("roomTitleCount").textContent = rooms.length + " 个";

            if (!rooms.length) {
                root.innerHTML = '<div class="empty">暂无打开的表格</div>';
                return;
            }

            root.innerHTML = rooms.map(room => \`
                <div class="room">
                    <div class="room-head">
                        <div>
                            <div class="room-name">\${escapeHtml(room.workbookName)}</div>
                            \${roomPathHtml(room)}
                        </div>
                        <span class="pill">\${room.userCount} 人</span>
                    </div>
                    \${renderUsers(room.users)}
                    <div class="meta">本房间编辑 \${room.editCount} 次，冲突 \${room.conflictCount} 个，更新于 \${time(room.updatedAt)}</div>
                </div>
            \`).join("");
        }

        function renderContributions(items) {
            const root = document.getElementById("contributions");
            const max = Math.max(1, ...items.map(item => item.editCount));

            if (!items.length) {
                root.innerHTML = '<div class="empty">' + contributionLabels[activeContributionWindow] + " 暂无编辑记录</div>";
                return;
            }

            root.innerHTML = items.map(item => \`
                <div class="contrib-row">
                    <span class="dot" style="background:\${escapeHtml(item.color)}"></span>
                    <div>
                        <div class="name">\${escapeHtml(item.userName)}</div>
                        <div class="meta">\${escapeHtml(item.workbookName)} · \${escapeHtml(item.lastSheetName)}!\${escapeHtml(item.lastAddress)} · \${time(item.lastEditedAt)}</div>
                        <div class="bar"><span style="width:\${Math.max(4, Math.round(item.editCount / max * 100))}%"></span></div>
                    </div>
                    <span class="pill">\${item.editCount} 次</span>
                </div>
            \`).join("");
        }

        function setContributionWindow(windowKey) {
            if (!contributionLabels[windowKey]) {
                return;
            }
            activeContributionWindow = windowKey;
            document.querySelectorAll(".contrib-tab").forEach(button => {
                button.classList.toggle("is-active", button.getAttribute("data-window") === windowKey);
            });
            renderContributions(contributionRankings[windowKey] || []);
        }

        function setupContributionTabs() {
            document.querySelectorAll(".contrib-tab").forEach(button => {
                button.addEventListener("click", () => {
                    setContributionWindow(button.getAttribute("data-window") || "recent7Days");
                });
            });
        }

        async function refresh() {
            try {
                const res = await fetch("/api/state", { cache: "no-store" });
                const data = await res.json();
                document.getElementById("clientCount").textContent = data.clientCount;
                document.getElementById("roomCount").textContent = data.roomCount;
                document.getElementById("editCount").textContent = data.totalEditCount;
                document.getElementById("conflictCount").textContent = data.totalConflictCount;
                document.getElementById("updatedAt").textContent = "刷新于 " + time(data.generatedAt);
                renderRooms(data.rooms);
                contributionRankings = {
                    recent7Days: Array.isArray(data.contributionRankings?.recent7Days)
                        ? data.contributionRankings.recent7Days
                        : (Array.isArray(data.contributions) ? data.contributions : []),
                    recent30Days: Array.isArray(data.contributionRankings?.recent30Days)
                        ? data.contributionRankings.recent30Days
                        : [],
                };
                setContributionWindow(activeContributionWindow);
            } catch (err) {
                document.getElementById("updatedAt").textContent = "读取失败：" + (err.message || err);
            }
        }

        function isMac() {
            const platform = navigator.userAgentData?.platform || navigator.platform || "";
            const ua = navigator.userAgent || "";
            return /mac/i.test(platform) || /macintosh|mac os x/i.test(ua);
        }

        function closeMacInstallModal() {
            document.getElementById("macInstallModal")?.classList.remove("show");
        }

        function openMacInstallModal() {
            document.getElementById("macInstallModal")?.classList.add("show");
        }

        async function copyMacInstallCommand() {
            const button = document.getElementById("copyMacInstallCommand");
            const commandNode = document.getElementById("macInstallCommand");
            const command = commandNode?.textContent || "";

            try {
                await navigator.clipboard.writeText(command);
                if (button) {
                    button.textContent = "已复制";
                    setTimeout(() => { button.textContent = "复制"; }, 1500);
                }
            } catch {
                if (commandNode) {
                    window.getSelection()?.selectAllChildren(commandNode);
                }
            }
        }

        function setupMacInstallModal() {
            document.getElementById("macInstallClose")?.addEventListener("click", closeMacInstallModal);
            document.getElementById("macInstallCancel")?.addEventListener("click", closeMacInstallModal);
            document.getElementById("copyMacInstallCommand")?.addEventListener("click", copyMacInstallCommand);
            document.getElementById("macInstallModal")?.addEventListener("click", event => {
                if (event.target === event.currentTarget) {
                    closeMacInstallModal();
                }
            });
            document.addEventListener("keydown", event => {
                if (event.key === "Escape") {
                    closeMacInstallModal();
                }
            });
        }

        function setupInstallLink() {
            const link = document.getElementById("installLink");
            if (!link || !isMac()) {
                return;
            }

            link.addEventListener("click", event => {
                event.preventDefault();
                openMacInstallModal();
            });
        }

        setupMacInstallModal();
        setupContributionTabs();
        setupInstallLink();
        refresh();
        setInterval(refresh, 2000);
    </script>
</body>
</html>`;
}
