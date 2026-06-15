function OnAddinLoad(ribbonUI) {
    if (typeof window.Application.ribbonUI !== "object") {
        window.Application.ribbonUI = ribbonUI;
    }

    if (typeof window.Application.Enum !== "object") {
        window.Application.Enum = WPS_Enum;
    }

    autoShowAnybodyHereTaskPane(0);
    return true;
}

function OnAction(control) {
    if (control.Id === "btnShowAnybodyHere") {
        showAnybodyHereTaskPane();
    }

    return true;
}

function GetLabel(control) {
    const chinese = isChineseUi();
    const id = control && (control.Id || control.id);

    if (id === "anybodyHereTab") {
        return chinese ? "表里有人" : "Anybody Here";
    }
    if (id === "anybodyHereGroup") {
        return chinese ? "表格协作" : "Spreadsheet Collaboration";
    }
    if (id === "btnShowAnybodyHere") {
        return chinese ? "协作看板" : "Collaboration Room";
    }

    return chinese ? "表里有人" : "Anybody Here";
}

function isChineseUi() {
    const language = getUiLanguage();
    return language ? /^zh\b/i.test(language) : true;
}

function getUiLanguage() {
    try {
        const settings = window.Application && window.Application.LanguageSettings;
        if (settings && typeof settings.LanguageID === "function") {
            const languageId = Number(settings.LanguageID(2));
            const zhLanguageIds = [1028, 2052, 3076, 4100, 5124];
            if (zhLanguageIds.indexOf(languageId) >= 0) {
                return "zh";
            }
            if (languageId) {
                return "en";
            }
        }
    } catch {
        // ignore
    }

    return (window.navigator && (window.navigator.language || window.navigator.userLanguage)) || "";
}

function showAnybodyHereTaskPane() {
    const storageKey = "anybody_here_taskpane_id";
    let taskPaneId = window.Application.PluginStorage.getItem(storageKey);

    if (taskPaneId) {
        try {
            const taskPane = window.Application.GetTaskPane(taskPaneId);
            taskPane.DockPosition = window.Application.Enum.msoCTPDockPositionRight;
            taskPane.Visible = true;
            return;
        } catch {
            window.Application.PluginStorage.setItem(storageKey, "");
        }
    }

    const taskPane = window.Application.CreateTaskPane(GetUrlPath() + "/ui/taskpane.html");
    taskPaneId = taskPane.ID;
    window.Application.PluginStorage.setItem(storageKey, taskPaneId);
    taskPane.DockPosition = window.Application.Enum.msoCTPDockPositionRight;
    taskPane.Visible = true;
}

function autoShowAnybodyHereTaskPane(attempt) {
    window.setTimeout(function () {
        try {
            if (!shouldAutoShowAnybodyHereTaskPane()) {
                return;
            }
            showAnybodyHereTaskPane();
        } catch (err) {
            if (attempt < 8) {
                autoShowAnybodyHereTaskPane(attempt + 1);
            }
        }
    }, attempt === 0 ? 600 : 1200);
}

function shouldAutoShowAnybodyHereTaskPane() {
    if (!hasAnybodyHereSavedSettings()) {
        return true;
    }

    if (!shouldIgnoreAnybodyHereExternalWorkbooks()) {
        return true;
    }

    const root = getAnybodyHereRepoRoot();
    const fullName = getActiveWorkbookFullName();
    if (!root || !fullName) {
        return true;
    }

    return isPathInAnybodyHereRepoRoot(fullName, root);
}

function hasAnybodyHereSavedSettings() {
    return safeLocalStorageGet("wpsAnybodyHere.settingsSaved") === "1";
}

function shouldIgnoreAnybodyHereExternalWorkbooks() {
    return safeLocalStorageGet("wpsAnybodyHere.ignoreExternalWorkbooks") !== "0";
}

function getAnybodyHereRepoRoot() {
    return normalizeAnybodyHereWorkbookPath(safeLocalStorageGet("wpsAnybodyHere.repoRoot") || "").replace(/\/$/, "");
}

function safeLocalStorageGet(key) {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return "";
    }
}

function getActiveWorkbookFullName() {
    try {
        const workbook = window.Application && window.Application.ActiveWorkbook;
        if (!workbook) {
            return "";
        }

        return String(workbook.FullName || joinAnybodyHerePath(workbook.Path || "", workbook.Name || "") || "");
    } catch {
        return "";
    }
}

function joinAnybodyHerePath(path, name) {
    if (!path) {
        return name;
    }

    return `${String(path).replace(/[\\\/]+$/, "")}/${name}`;
}

function normalizeAnybodyHereWorkbookPath(path) {
    return String(path || "").replace(/\\/g, "/").replace(/\/+/g, "/");
}

function isPathInAnybodyHereRepoRoot(fullName, root) {
    const normalized = normalizeAnybodyHereWorkbookPath(fullName).toLowerCase();
    const normalizedRoot = normalizeAnybodyHereWorkbookPath(root).replace(/\/$/, "").toLowerCase();
    return Boolean(normalized && normalizedRoot && normalized.indexOf(normalizedRoot + "/") === 0);
}

function GetImage() {
    return "images/3.svg";
}
