import http from "node:http";
import { WebSocketServer } from "ws";
import { renderDashboardHtml } from "./dashboard";
import { RoomManager } from "./room-manager";

const HEARTBEAT_TIMEOUT_MS = Number(process.env.HEARTBEAT_TIMEOUT_MS || 30_000);
const port = Number(process.env.PORT || 18080);

const roomManager = new RoomManager();

const server = http.createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = req.url || "/";

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
    console.log(`health check: http://127.0.0.1:${port}/health`);
});
