import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";
import type { RepoPushInfo } from "@wps-anybody-here/shared";
import { renderDashboardHtml } from "./dashboard";
import { RoomManager } from "./room-manager";

const HEARTBEAT_TIMEOUT_MS = Number(process.env.HEARTBEAT_TIMEOUT_MS || 30_000);
const WEBHOOK_BODY_LIMIT_BYTES = Number(process.env.WEBHOOK_BODY_LIMIT_BYTES || 1024 * 1024);
const port = Number(process.env.PORT || 18080);
const addinPackageDir = process.env.ADDIN_PACKAGE_DIR || path.resolve(__dirname, "../../addin");
const addinPublishDir = path.join(addinPackageDir, "wps-addon-publish");
const addinBuildDir = path.join(addinPackageDir, "wps-addon-build");
const macInstallScript = process.env.MAC_INSTALL_SCRIPT || path.resolve(__dirname, "../../../scripts/mac-install.sh");

const roomManager = new RoomManager();

function contentTypeFor(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    const types: Record<string, string> = {
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".ico": "image/x-icon",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml; charset=utf-8",
        ".xml": "application/xml; charset=utf-8",
    };

    return types[ext] || "application/octet-stream";
}

function isPathInside(root: string, target: string) {
    const relative = path.relative(root, target);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function requestUrl(req: http.IncomingMessage) {
    try {
        return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    } catch {
        return new URL("/", "http://localhost");
    }
}

function readJsonBody(req: http.IncomingMessage) {
    return new Promise<unknown>((resolve, reject) => {
        let body = "";

        req.setEncoding("utf8");
        req.on("data", chunk => {
            body += chunk;
            if (Buffer.byteLength(body, "utf8") > WEBHOOK_BODY_LIMIT_BYTES) {
                reject(new Error("Request body is too large"));
                req.destroy();
            }
        });
        req.on("end", () => {
            if (!body.trim()) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asText(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown) {
    return isRecord(value) ? value : {};
}

function asRecordList(value: unknown) {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizeRepoUrl(value: unknown) {
    return asText(value).replace(/\/+$/, "");
}

function normalizeWorkbookPath(value: unknown) {
    return asText(value).replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
}

function collectRepoUrls(payload: Record<string, unknown>, queryRepoUrl: string) {
    const urls = new Set<string>();
    const repository = asRecord(payload.repository);
    const project = asRecord(payload.project);

    [
        queryRepoUrl,
        payload.repoUrl,
        payload.repositoryUrl,
        repository.html_url,
        repository.web_url,
        repository.clone_url,
        repository.git_http_url,
        repository.url,
        project.web_url,
        project.git_http_url,
        project.http_url_to_repo,
    ].forEach(value => {
        const url = normalizeRepoUrl(value);
        if (url) {
            urls.add(url);
            if (url.endsWith(".git")) {
                urls.add(url.slice(0, -4));
            }
        }
    });

    return Array.from(urls);
}

function collectChangedPaths(payload: Record<string, unknown>) {
    const paths = new Set<string>();

    function addPath(value: unknown) {
        const normalized = normalizeWorkbookPath(value);
        if (normalized) {
            paths.add(normalized);
        }
    }

    function addPathList(value: unknown) {
        if (Array.isArray(value)) {
            value.forEach(addPath);
        } else {
            addPath(value);
        }
    }

    addPath(payload.workbookPath);
    addPath(payload.path);
    addPathList(payload.paths);

    for (const commit of asRecordList(payload.commits)) {
        addPathList(commit.added);
        addPathList(commit.modified);
        addPathList(commit.removed);
    }

    const headCommit = asRecord(payload.head_commit);
    addPathList(headCommit.added);
    addPathList(headCommit.modified);
    addPathList(headCommit.removed);

    return Array.from(paths);
}

function lastCommit(payload: Record<string, unknown>) {
    const headCommit = asRecord(payload.head_commit);
    if (Object.keys(headCommit).length) {
        return headCommit;
    }

    const commits = asRecordList(payload.commits);
    return commits[commits.length - 1] || {};
}

function limitText(value: unknown, maxLength: number) {
    const text = asText(value).replace(/\s+/g, " ");
    if (text.length <= maxLength) {
        return text;
    }

    return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function makeRepoPushes(payload: Record<string, unknown>, queryRepoUrl: string) {
    const repoUrls = collectRepoUrls(payload, queryRepoUrl);
    const paths = collectChangedPaths(payload);
    const commit = lastCommit(payload);
    const pusher = asRecord(payload.pusher);
    const sender = asRecord(payload.sender);
    const user = asRecord(payload.user);
    const pusherName = limitText(
        payload.pusherName ||
            payload.user_name ||
            pusher.name ||
            pusher.username ||
            sender.login ||
            sender.name ||
            user.name,
        40,
    ) || "有人";
    const message = limitText(payload.message || commit.message || "推送了表格仓库更新", 160);
    const commitId = limitText(payload.commitId || commit.id || payload.after || payload.checkout_sha, 40);
    const commitUrl = limitText(payload.commitUrl || commit.url, 240);
    const updatedAt = Date.now();
    const pushes: RepoPushInfo[] = [];

    for (const repoUrl of repoUrls) {
        for (const workbookPath of paths) {
            pushes.push({
                id: `${updatedAt}:${repoUrl}:${workbookPath}:${commitId || message}`,
                repoUrl,
                workbookPath,
                pusherName,
                message,
                ...(commitId ? { commitId } : {}),
                ...(commitUrl ? { commitUrl } : {}),
                updatedAt,
            });
        }
    }

    return pushes;
}

async function handleRepoWebhook(req: http.IncomingMessage, res: http.ServerResponse, queryRepoUrl: string) {
    if (req.method !== "POST") {
        res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "POST required" }));
        return;
    }

    let payload: unknown;
    try {
        payload = await readJsonBody(req);
    } catch (err) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Invalid request body" }));
        return;
    }

    if (!isRecord(payload)) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "JSON object required" }));
        return;
    }

    const pushes = makeRepoPushes(payload, queryRepoUrl);
    if (!pushes.length) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "repoUrl and changed workbook path are required" }));
        return;
    }

    let delivered = 0;
    for (const push of pushes) {
        delivered += roomManager.broadcastRepoPush(push);
    }

    res.writeHead(202, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
    });
    res.end(JSON.stringify({ ok: true, pushes: pushes.length, delivered }));
}

function sendFile(res: http.ServerResponse, filePath: string, headers: http.OutgoingHttpHeaders = {}) {
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
        if (!res.headersSent) {
            res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        }
        res.end("Failed to read file");
    });

    res.writeHead(200, {
        "content-type": contentTypeFor(filePath),
        "cache-control": path.extname(filePath).toLowerCase() === ".html" ? "no-store" : "public, max-age=60",
        ...headers,
    });
    stream.pipe(res);
}

function tryServeMacInstallScript(pathname: string, res: http.ServerResponse) {
    if (pathname !== "/install/mac-install.sh") {
        return false;
    }

    try {
        const stat = fs.statSync(macInstallScript);
        if (stat.isFile()) {
            sendFile(res, macInstallScript, {
                "content-type": "text/x-shellscript; charset=utf-8",
                "content-disposition": "attachment; filename=\"mac-install.sh\"",
                "cache-control": "no-store",
            });
            return true;
        }
    } catch {
        // Fall through to the script-specific 404 below.
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Mac install script not found.");
    return true;
}

function tryServeAddinStatic(pathname: string, res: http.ServerResponse) {
    if (pathname === "/addin") {
        res.writeHead(302, { location: "/addin/" });
        res.end();
        return true;
    }

    if (!pathname.startsWith("/addin/")) {
        return false;
    }

    const relativePath = pathname.slice("/addin/".length) || "publish.html";
    const candidates = [
        { root: addinPublishDir, filePath: path.join(addinPublishDir, relativePath) },
        { root: addinBuildDir, filePath: path.join(addinBuildDir, relativePath) },
    ];

    if (relativePath.startsWith("wps-addon-publish/")) {
        candidates.push({ root: addinPublishDir, filePath: path.join(addinPackageDir, relativePath) });
    }

    if (relativePath.startsWith("wps-addon-build/")) {
        candidates.push({ root: addinBuildDir, filePath: path.join(addinPackageDir, relativePath) });
    }

    for (const candidate of candidates) {
        if (!isPathInside(candidate.root, candidate.filePath)) {
            continue;
        }

        try {
            const stat = fs.statSync(candidate.filePath);
            if (stat.isFile()) {
                sendFile(res, candidate.filePath);
                return true;
            }
        } catch {
            // Try the next publish output location.
        }
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Add-in publish asset not found. Run npm run publish:addin first.");
    return true;
}

const server = http.createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = requestUrl(req);
    const url = decodeURIComponent(parsedUrl.pathname);

    if (url === "/" || url === "/dashboard") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderDashboardHtml());
        return;
    }

    if (url === "/api/state") {
        res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
        });
        res.end(JSON.stringify(roomManager.getSnapshot()));
        return;
    }

    if (url === "/health") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
            ok: true,
            rooms: roomManager.roomCount,
            clients: roomManager.clientCount,
        }));
        return;
    }

    if (url === "/api/webhooks/repo-push" || url === "/webhooks/repo-push") {
        void handleRepoWebhook(req, res, parsedUrl.searchParams.get("repoUrl") || "");
        return;
    }

    if (tryServeMacInstallScript(url, res) || tryServeAddinStatic(url, res)) {
        return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
});

const wss = new WebSocketServer({ server });

wss.on("connection", ws => {
    ws.on("message", raw => {
        roomManager.handleMessage(ws, raw);
    });

    ws.on("close", () => {
        roomManager.cleanupClient(ws, { notify: true });
    });

    ws.on("error", () => {
        roomManager.cleanupClient(ws, { notify: true });
    });
});

setInterval(() => {
    roomManager.cleanupTimedOutClients(HEARTBEAT_TIMEOUT_MS);
}, 5_000);

server.listen(port, () => {
    console.log(`wps-anybody-here server listening on ws://127.0.0.1:${port}`);
    console.log(`dashboard: http://127.0.0.1:${port}/`);
    console.log(`add-in assets: http://127.0.0.1:${port}/addin/`);
    console.log(`health check: http://127.0.0.1:${port}/health`);
});
