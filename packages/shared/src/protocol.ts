export type ClientMsg =
    | JoinMsg
    | UserUpdateMsg
    | LeaveMsg
    | HeartbeatMsg
    | SelectionMsg
    | CellChangeMsg;

export interface JoinMsg {
    type: "join";
    roomId: string;
    userId: string;
    userName: string;
    color: string;
    workbookName: string;
}

export interface LeaveMsg {
    type: "leave";
}

export interface UserUpdateMsg {
    type: "userUpdate";
    userName: string;
    color: string;
}

export interface HeartbeatMsg {
    type: "heartbeat";
}

export interface SelectionMsg {
    type: "selection";
    sheetName: string;
    address: string;
    rowId?: string;
    fieldName?: string;
    row?: number;
    col?: number;
}

export interface CellChangeMsg {
    type: "cellChange";
    sheetName: string;
    address: string;
    rowId?: string;
    fieldName?: string;
    oldValue?: unknown;
    newValue: unknown;
}

export type ServerMsg =
    | JoinedServerMsg
    | PresenceServerMsg
    | UserJoinedServerMsg
    | UserLeftServerMsg
    | SelectionServerMsg
    | SelectionRemovedServerMsg
    | CellChangeServerMsg
    | ConflictsServerMsg
    | RepoPushServerMsg
    | ErrorServerMsg;

export interface JoinedServerMsg {
    type: "joined";
    roomId: string;
    users: UserInfo[];
    selections: SelectionInfo[];
    conflicts: ConflictInfo[];
}

export interface PresenceServerMsg {
    type: "presence";
    users: UserInfo[];
}

export interface UserJoinedServerMsg {
    type: "userJoined";
    user: UserInfo;
}

export interface UserLeftServerMsg {
    type: "userLeft";
    user: UserInfo;
}

export interface SelectionServerMsg {
    type: "selection";
    selection: SelectionInfo;
}

export interface SelectionRemovedServerMsg {
    type: "selectionRemoved";
    userId: string;
}

export interface CellChangeServerMsg {
    type: "cellChange";
    change: ChangeInfo;
}

export interface ConflictsServerMsg {
    type: "conflicts";
    conflicts: ConflictInfo[];
}

export interface RepoPushServerMsg {
    type: "repoPush";
    push: RepoPushInfo;
}

export interface ErrorServerMsg {
    type: "error";
    message: string;
}

export interface UserInfo {
    userId: string;
    userName: string;
    color: string;
    workbookName: string;
    lastHeartbeatAt?: number;
}

export interface SelectionInfo {
    userId: string;
    userName: string;
    color: string;
    sheetName: string;
    address: string;
    rowId?: string;
    fieldName?: string;
    updatedAt: number;
}

export interface ChangeInfo {
    userId: string;
    userName: string;
    color: string;
    sheetName: string;
    address: string;
    rowId?: string;
    fieldName?: string;
    oldValue?: unknown;
    newValue: unknown;
    updatedAt: number;
}

export interface ConflictInfo {
    key: string;
    sheetName: string;
    address: string;
    rowId?: string;
    fieldName?: string;
    users: Array<{
        userId: string;
        userName: string;
        color: string;
        newValue: unknown;
    }>;
}

export interface RepoPushInfo {
    id: string;
    repoUrl: string;
    workbookPath: string;
    pusherName: string;
    message: string;
    commitId?: string;
    commitUrl?: string;
    updatedAt: number;
}

export function makeCellKey(sheetName: string, address: string) {
    return `${sheetName}::${address}`;
}
