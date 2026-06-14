import type { WebSocket } from "ws";
import type { ChangeInfo, SelectionInfo } from "@wps-anybody-here/shared";

export interface ClientInfo {
    ws: WebSocket;
    roomId: string;
    userId: string;
    userName: string;
    color: string;
    workbookName: string;
    joinedAt: number;
    lastHeartbeatAt: number;
}

export interface ContributionInfo {
    userId: string;
    userName: string;
    color: string;
    editCount: number;
    lastEditedAt: number;
    lastSheetName: string;
    lastAddress: string;
}

export interface Room {
    roomId: string;
    clients: Map<string, ClientInfo>;
    selections: Map<string, SelectionInfo>;
    changes: Map<string, ChangeInfo[]>;
    contributions: Map<string, ContributionInfo>;
    createdAt: number;
    updatedAt: number;
}
