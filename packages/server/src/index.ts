import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";
import { renderDashboardHtml } from "./dashboard";
import { RoomManager } from "./room-manager";

const HEARTBEAT_TIMEOUT_MS = Number(process.env.HEARTBEAT_TIMEOUT_MS || 30_000);
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

function requestPath(req: http.IncomingMessage) {
    try {
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        return decodeURIComponent(url.pathname);
    } catch {
        return "/";
    }
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
    res.setHeader("access-control-allow-methods", "GET, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = requestPath(req);

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
