import { WebSocket, type RawData } from "ws";
import {
    type CellChangeMsg,
    type ChangeInfo,
    type ClientMsg,
    type ConflictInfo,
    type JoinMsg,
    type SelectionInfo,
    type SelectionMsg,
    type ServerMsg,
    type UserUpdateMsg,
    type UserInfo,
} from "@wps-anybody-here/shared";
import type { ClientInfo, ContributionInfo, Room } from "./types";

function makeCellKey(sheetName: string, address: string) {
    return `${sheetName}::${address}`;
}

function makeEditKey(sheetName: string, address: string, rowId?: string, fieldName?: string) {
    if (rowId && fieldName) {
        return `${sheetName}::id:${rowId}::field:${fieldName}`;
    }

    return makeCellKey(sheetName, address);
}

interface DashboardUser {
    userId: string;
    userName: string;
    color: string;
    workbookName: string;
    joinedAt: number;
    lastHeartbeatAt: number;
    selection: SelectionInfo | null;
}

interface DashboardContribution extends ContributionInfo {
    roomId: string;
    workbookName: string;
}

export class RoomManager {
    private readonly rooms = new Map<string, Room>();
    private readonly clientMap = new Map<WebSocket, ClientInfo>();

    get roomCount() {
        return this.rooms.size;
    }

    get clientCount() {
        return this.getUniqueUsers().length;
    }

    getSnapshot() {
        const uniqueUsers = this.getUniqueUsers();
        const rooms = Array.from(this.rooms.values()).map(room => {
            const users = Array.from(room.clients.values()).map(client => this.toDashboardUser(client, room));
            const contributions = Array.from(room.contributions.values())
                .sort((a, b) => b.editCount - a.editCount || b.lastEditedAt - a.lastEditedAt);
            const conflicts = this.detectConflicts(room);
            const editCount = contributions.reduce((sum, item) => sum + item.editCount, 0);
            const workbookName = users[0]?.workbookName || contributions[0]?.lastSheetName || room.roomId;

            return {
                roomId: room.roomId,
                workbookName,
                userCount: users.length,
                users,
                selections: Array.from(room.selections.values()),
                conflictCount: conflicts.length,
                conflicts,
                editCount,
                contributions,
                createdAt: room.createdAt,
                updatedAt: room.updatedAt,
            };
        }).sort((a, b) => b.updatedAt - a.updatedAt);

        const globalContributionMap = new Map<string, DashboardContribution>();

        for (const room of rooms) {
            for (const contribution of room.contributions) {
                const existing = globalContributionMap.get(contribution.userId);
                if (!existing) {
                    globalContributionMap.set(contribution.userId, {
                        ...contribution,
                        roomId: room.roomId,
                        workbookName: room.workbookName,
                    });
                    continue;
                }

                existing.editCount += contribution.editCount;
                if (contribution.lastEditedAt > existing.lastEditedAt) {
                    existing.lastEditedAt = contribution.lastEditedAt;
                    existing.lastSheetName = contribution.lastSheetName;
                    existing.lastAddress = contribution.lastAddress;
                    existing.roomId = room.roomId;
                    existing.workbookName = room.workbookName;
                }
            }
        }

        const contributions = Array.from(globalContributionMap.values())
            .sort((a, b) => b.editCount - a.editCount || b.lastEditedAt - a.lastEditedAt);

        return {
            generatedAt: Date.now(),
            roomCount: rooms.length,
            clientCount: uniqueUsers.length,
            connectionCount: this.clientMap.size,
            totalEditCount: contributions.reduce((sum, item) => sum + item.editCount, 0),
            totalConflictCount: rooms.reduce((sum, room) => sum + room.conflictCount, 0),
            users: uniqueUsers,
            rooms,
            contributions,
        };
    }

    handleMessage(ws: WebSocket, raw: RawData) {
        let msg: ClientMsg;

        try {
            msg = JSON.parse(raw.toString()) as ClientMsg;
        } catch {
            this.send(ws, { type: "error", message: "Invalid JSON" });
            return;
        }

        if (!msg || typeof msg.type !== "string") {
            this.send(ws, { type: "error", message: "Invalid message" });
            return;
        }

        if (msg.type === "join") {
            this.handleJoin(ws, msg);
            return;
        }

        const client = this.clientMap.get(ws);
        if (!client) {
            this.send(ws, { type: "error", message: "Please join first" });
            return;
        }

        if (msg.type === "heartbeat") {
            client.lastHeartbeatAt = Date.now();
            return;
        }

        if (msg.type === "selection") {
            this.handleSelection(client, msg);
            return;
        }

        if (msg.type === "userUpdate") {
            this.handleUserUpdate(client, msg);
            return;
        }

        if (msg.type === "cellChange") {
            this.handleCellChange(client, msg);
            return;
        }

        if (msg.type === "leave") {
            this.cleanupClient(ws, { notify: true });
        }
    }

    cleanupClient(ws: WebSocket, options: { notify: boolean }) {
        const client = this.clientMap.get(ws);
        if (!client) {
            return;
        }

        this.clientMap.delete(ws);

        const room = this.rooms.get(client.roomId);
        if (!room) {
            return;
        }

        const current = room.clients.get(client.userId);
        if (current?.ws !== ws) {
            return;
        }

        room.clients.delete(client.userId);
        room.selections.delete(client.userId);
        this.removeUserChanges(room, client.userId);
        room.updatedAt = Date.now();

        if (options.notify) {
            this.broadcast(room, {
                type: "userLeft",
                user: this.toUserInfo(client),
            }, client.userId);
        }

        this.broadcast(room, {
            type: "presence",
            users: this.buildPresence(room),
        });

        this.broadcast(room, {
            type: "selectionRemoved",
            userId: client.userId,
        });

        this.broadcast(room, {
            type: "conflicts",
            conflicts: this.detectConflicts(room),
        });

        if (room.clients.size === 0) {
            this.rooms.delete(room.roomId);
        }
    }

    cleanupTimedOutClients(timeoutMs: number) {
        const now = Date.now();

        for (const client of Array.from(this.clientMap.values())) {
            if (now - client.lastHeartbeatAt <= timeoutMs) {
                continue;
            }

            this.cleanupClient(client.ws, { notify: true });
            try {
                client.ws.close();
            } catch {
                // ignore
            }
        }
    }

    private handleJoin(ws: WebSocket, msg: JoinMsg) {
        const roomId = this.normalizeText(msg.roomId);
        const userId = this.normalizeText(msg.userId);
        const userName = this.normalizeText(msg.userName) || "未命名用户";
        const color = this.normalizeText(msg.color) || "#4E7FFF";
        const workbookName = this.normalizeText(msg.workbookName) || "未命名表格";

        if (!roomId || !userId) {
            this.send(ws, { type: "error", message: "roomId and userId are required" });
            return;
        }

        const previous = this.clientMap.get(ws);
        if (previous && (previous.roomId !== roomId || previous.userId !== userId)) {
            this.cleanupClient(ws, { notify: false });
        }

        const room = this.getRoom(roomId);
        const existing = room.clients.get(userId);
        const isReplacement = Boolean(existing);
        const joinedAt = existing?.joinedAt || Date.now();

        if (existing && existing.ws !== ws) {
            this.clientMap.delete(existing.ws);
            try {
                existing.ws.close();
            } catch {
                // ignore
            }
        }

        const client: ClientInfo = {
            ws,
            roomId,
            userId,
            userName,
            color,
            workbookName,
            joinedAt,
            lastHeartbeatAt: Date.now(),
        };

        this.clientMap.set(ws, client);
        room.clients.set(userId, client);
        room.updatedAt = Date.now();
        this.updateRoomUserDisplay(room, client);

        this.send(ws, {
            type: "joined",
            roomId: room.roomId,
            users: this.buildPresence(room),
            selections: Array.from(room.selections.values()),
            conflicts: this.detectConflicts(room),
        });

        if (!isReplacement) {
            this.broadcast(room, {
                type: "userJoined",
                user: this.toUserInfo(client),
            }, client.userId);
        }

        this.broadcast(room, {
            type: "presence",
            users: this.buildPresence(room),
        });

        if (isReplacement) {
            const selection = room.selections.get(client.userId);
            if (selection) {
                this.broadcast(room, {
                    type: "selection",
                    selection,
                }, client.userId);
            }

            this.broadcast(room, {
                type: "conflicts",
                conflicts: this.detectConflicts(room),
            });
        }
    }

    private handleUserUpdate(client: ClientInfo, msg: UserUpdateMsg) {
        const userName = this.normalizeText(msg.userName) || client.userName;
        const color = this.normalizeColor(msg.color) || client.color;

        if (userName === client.userName && color === client.color) {
            return;
        }

        client.userName = userName;
        client.color = color;
        client.lastHeartbeatAt = Date.now();

        const room = this.getRoom(client.roomId);
        const current = room.clients.get(client.userId);
        if (current) {
            current.userName = userName;
            current.color = color;
            current.lastHeartbeatAt = client.lastHeartbeatAt;
        }

        room.updatedAt = client.lastHeartbeatAt;
        this.updateRoomUserDisplay(room, client);

        this.broadcast(room, {
            type: "presence",
            users: this.buildPresence(room),
        });

        const selection = room.selections.get(client.userId);
        if (selection) {
            this.broadcast(room, {
                type: "selection",
                selection,
            }, client.userId);
        }

        this.broadcast(room, {
            type: "conflicts",
            conflicts: this.detectConflicts(room),
        });
    }

    private handleSelection(client: ClientInfo, msg: SelectionMsg) {
        const sheetName = this.normalizeText(msg.sheetName);
        const address = this.normalizeText(msg.address);
        const rowId = this.normalizeText(msg.rowId);
        const fieldName = this.normalizeText(msg.fieldName);

        if (!sheetName || !address) {
            this.send(client.ws, { type: "error", message: "sheetName and address are required" });
            return;
        }

        if (!this.isCellAddress(address)) {
            this.send(client.ws, { type: "error", message: "address is invalid" });
            return;
        }

        const room = this.getRoom(client.roomId);
        const selection: SelectionInfo = {
            userId: client.userId,
            userName: client.userName,
            color: client.color,
            sheetName,
            address,
            ...(rowId ? { rowId } : {}),
            ...(fieldName ? { fieldName } : {}),
            updatedAt: Date.now(),
        };

        room.selections.set(client.userId, selection);
        room.updatedAt = selection.updatedAt;

        this.broadcast(room, {
            type: "selection",
            selection,
        }, client.userId);
    }

    private handleCellChange(client: ClientInfo, msg: CellChangeMsg) {
        const sheetName = this.normalizeText(msg.sheetName);
        const address = this.normalizeText(msg.address);
        const rowId = this.normalizeText(msg.rowId);
        const fieldName = this.normalizeText(msg.fieldName);

        if (!sheetName || !address) {
            this.send(client.ws, { type: "error", message: "sheetName and address are required" });
            return;
        }

        if (!this.isCellAddress(address)) {
            this.send(client.ws, { type: "error", message: "address is invalid" });
            return;
        }

        const room = this.getRoom(client.roomId);
        const key = makeEditKey(sheetName, address, rowId, fieldName);
        const now = Date.now();
        const change: ChangeInfo = {
            userId: client.userId,
            userName: client.userName,
            color: client.color,
            sheetName,
            address,
            ...(rowId ? { rowId } : {}),
            ...(fieldName ? { fieldName } : {}),
            oldValue: msg.oldValue,
            newValue: msg.newValue,
            updatedAt: now,
        };

        const list = room.changes.get(key) || [];
        list.push(change);

        if (list.length > 30) {
            list.splice(0, list.length - 30);
        }

        room.changes.set(key, list);
        room.updatedAt = now;
        this.recordContribution(room, client, sheetName, address, now);

        this.broadcast(room, {
            type: "cellChange",
            change,
        }, client.userId);

        this.broadcast(room, {
            type: "conflicts",
            conflicts: this.detectConflicts(room),
        });
    }

    private getRoom(roomId: string): Room {
        let room = this.rooms.get(roomId);
        if (!room) {
            const now = Date.now();
            room = {
                roomId,
                clients: new Map(),
                selections: new Map(),
                changes: new Map(),
                contributions: new Map(),
                createdAt: now,
                updatedAt: now,
            };
            this.rooms.set(roomId, room);
        }
        return room;
    }

    private send(ws: WebSocket, data: ServerMsg) {
        if (ws.readyState !== WebSocket.OPEN) {
            return;
        }

        try {
            ws.send(JSON.stringify(data));
        } catch {
            // ignore broken clients; close/error handlers will clean them up
        }
    }

    private broadcast(room: Room, data: ServerMsg, exceptUserId?: string) {
        for (const client of room.clients.values()) {
            if (exceptUserId && client.userId === exceptUserId) {
                continue;
            }
            this.send(client.ws, data);
        }
    }

    private buildPresence(room: Room): UserInfo[] {
        return Array.from(room.clients.values()).map(client => this.toUserInfo(client));
    }

    private detectConflicts(room: Room): ConflictInfo[] {
        const conflicts: ConflictInfo[] = [];

        for (const [key, list] of room.changes.entries()) {
            const latestByUser = new Map<string, ChangeInfo>();

            for (const item of list) {
                latestByUser.set(item.userId, item);
            }

            if (latestByUser.size <= 1) {
                continue;
            }

            const first = list[0];
            conflicts.push({
                key,
                sheetName: first.sheetName,
                address: first.address,
                ...(first.rowId ? { rowId: first.rowId } : {}),
                ...(first.fieldName ? { fieldName: first.fieldName } : {}),
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

    private removeUserChanges(room: Room, userId: string) {
        for (const [key, list] of Array.from(room.changes.entries())) {
            const next = list.filter(item => item.userId !== userId);

            if (next.length) {
                room.changes.set(key, next);
            } else {
                room.changes.delete(key);
            }
        }
    }

    private toUserInfo(client: ClientInfo): UserInfo {
        return {
            userId: client.userId,
            userName: client.userName,
            color: client.color,
            workbookName: client.workbookName,
            lastHeartbeatAt: client.lastHeartbeatAt,
        };
    }

    private toDashboardUser(client: ClientInfo, room: Room): DashboardUser {
        return {
            userId: client.userId,
            userName: client.userName,
            color: client.color,
            workbookName: client.workbookName,
            joinedAt: client.joinedAt,
            lastHeartbeatAt: client.lastHeartbeatAt,
            selection: room.selections.get(client.userId) || null,
        };
    }

    private getUniqueUsers(): DashboardUser[] {
        const users = new Map<string, DashboardUser>();

        for (const client of this.clientMap.values()) {
            const room = this.rooms.get(client.roomId);
            if (!room) {
                continue;
            }

            const current = users.get(client.userId);
            const next = this.toDashboardUser(client, room);

            if (!current || next.lastHeartbeatAt > current.lastHeartbeatAt) {
                users.set(client.userId, next);
            }
        }

        return Array.from(users.values()).sort((a, b) => a.userName.localeCompare(b.userName));
    }

    private updateRoomUserDisplay(room: Room, client: ClientInfo) {
        const selection = room.selections.get(client.userId);
        if (selection) {
            selection.userName = client.userName;
            selection.color = client.color;
            selection.updatedAt = Date.now();
        }

        const contribution = room.contributions.get(client.userId);
        if (contribution) {
            contribution.userName = client.userName;
            contribution.color = client.color;
        }

        for (const list of room.changes.values()) {
            for (const change of list) {
                if (change.userId === client.userId) {
                    change.userName = client.userName;
                    change.color = client.color;
                }
            }
        }
    }

    private recordContribution(room: Room, client: ClientInfo, sheetName: string, address: string, now: number) {
        const current = room.contributions.get(client.userId);

        if (!current) {
            room.contributions.set(client.userId, {
                userId: client.userId,
                userName: client.userName,
                color: client.color,
                editCount: 1,
                lastEditedAt: now,
                lastSheetName: sheetName,
                lastAddress: address,
            });
            return;
        }

        current.userName = client.userName;
        current.color = client.color;
        current.editCount += 1;
        current.lastEditedAt = now;
        current.lastSheetName = sheetName;
        current.lastAddress = address;
    }

    private normalizeText(value: unknown) {
        return typeof value === "string" ? value.trim() : "";
    }

    private normalizeColor(value: unknown) {
        const color = this.normalizeText(value);
        return /^#[0-9a-f]{6}$/i.test(color) ? color : "";
    }

    private isCellAddress(value: string) {
        return /^\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?$/i.test(value);
    }
}
