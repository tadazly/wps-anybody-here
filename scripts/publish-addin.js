const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const addinDir = path.join(repoRoot, "packages", "addin");
const addinBuildDir = path.join(addinDir, "wps-addon-build");
const addinPublishDir = path.join(addinDir, "wps-addon-publish");
const macInstallScript = path.join(repoRoot, "scripts", "mac-install.sh");
const args = process.argv.slice(2);

function namedArgValue(name, alias) {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === name || arg === alias) {
            return args[index + 1];
        }

        if (arg.startsWith(`${name}=`)) {
            return arg.slice(name.length + 1);
        }
    }

    return undefined;
}

function positionalArgs() {
    const values = [];

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg.startsWith("-")) {
            if (!arg.includes("=")) {
                index += 1;
            }
            continue;
        }

        values.push(arg);
    }

    return values;
}

function normalizePort(value) {
    const port = Number(value || 18080);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        console.error(`Invalid port: ${value}`);
        process.exit(1);
    }

    return port;
}

function looksLikePublishUrl(value) {
    return /^https?:\/\//i.test(value) || value.includes(".") || value.includes(":");
}

function normalizePublishBaseUrl(value) {
    const rawUrl = String(value || "").trim();
    if (!rawUrl) {
        console.error("Publish URL cannot be empty.");
        process.exit(1);
    }

    const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`;

    try {
        const url = new URL(withProtocol);
        if (url.pathname === "" || url.pathname === "/") {
            url.pathname = "/addin/";
        } else if (!url.pathname.endsWith("/")) {
            url.pathname = `${url.pathname}/`;
        }

        return url.toString();
    } catch {
        console.error(`Invalid publish URL: ${value}`);
        process.exit(1);
    }
}

function installUrlFor(publishUrl) {
    try {
        return new URL(publishUrl).origin;
    } catch {
        console.error(`Invalid publish URL: ${publishUrl}`);
        process.exit(1);
    }
}

function escapeXmlAttribute(value) {
    return String(value).replace(/[&<>"']/g, ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
    }[ch]));
}

function removePreviousPublishOutput() {
    for (const dir of [addinBuildDir, addinPublishDir]) {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
            console.log(`Removed previous publish output: ${path.relative(repoRoot, dir)}`);
        }
    }
}

function updateMacInstallScript(publishUrl) {
    if (!fs.existsSync(macInstallScript)) {
        console.warn(`Mac install script not found: ${path.relative(repoRoot, macInstallScript)}`);
        return;
    }

    const escapedPublishUrl = escapeXmlAttribute(publishUrl);
    const escapedInstallUrl = escapeXmlAttribute(installUrlFor(publishUrl));
    const content = fs.readFileSync(macInstallScript, "utf8");
    const updated = content.replace(
        /plugin_content='([^']*)'/,
        (match, pluginContent) => {
            const updatedPluginContent = pluginContent
                .replace(/\burl="[^"]*"/, `url="${escapedPublishUrl}"`)
                .replace(/\binstall="[^"]*"/, `install="${escapedInstallUrl}"`);

            if (updatedPluginContent === pluginContent) {
                return match;
            }

            return `plugin_content='${updatedPluginContent}'`;
        },
    );

    if (updated === content) {
        console.warn("Mac install script plugin_content was not updated.");
        return;
    }

    fs.writeFileSync(macInstallScript, updated);
    console.log(`Updated Mac install script URL: ${path.relative(repoRoot, macInstallScript)}`);
}

const positions = positionalArgs();
const explicitPublishUrl = namedArgValue("--publish-url", "-u") || namedArgValue("--url") || process.env.ADDIN_PUBLISH_URL;
const positionalPublishUrl = positions.find(looksLikePublishUrl);
const port = normalizePort(namedArgValue("--port", "-p") || process.env.PORT || positions.find(value => /^\d+$/.test(value)));
const publishBaseUrl = normalizePublishBaseUrl(explicitPublishUrl || positionalPublishUrl || `http://127.0.0.1:${port}/addin/`);

console.log(`Using add-in publish URL: ${publishBaseUrl}`);
removePreviousPublishOutput();

const child = spawn("wpsjs", ["publish"], {
    cwd: addinDir,
    env: {
        ...process.env,
        FORCE_COLOR: process.env.FORCE_COLOR || "1",
    },
    shell: process.platform === "win32",
    stdio: ["pipe", "pipe", "pipe"],
});

const steps = {
    url: false,
    publishType: false,
    multiUser: false,
};
let closeInputTimer;

function writeInput(value) {
    if (!child.stdin.destroyed) {
        child.stdin.write(value);
    }
}

function closeInputSoon() {
    if (closeInputTimer) {
        return;
    }

    closeInputTimer = setTimeout(() => {
        if (!child.stdin.destroyed) {
            child.stdin.end();
        }
    }, 200);
}

function answerFromOutput(chunk) {
    const text = chunk.toString();

    if (!steps.url && text.includes("请输入发布 WPS 加载项的服务器地址")) {
        steps.url = true;
        writeInput(`${publishBaseUrl}\n`);
        return;
    }

    if (!steps.publishType && text.includes("选择 WPS 加载项发布类型")) {
        steps.publishType = true;
        writeInput("\r");
        return;
    }

    if (!steps.multiUser && (text.includes("多用户同时使用") || text.includes("publish页面"))) {
        steps.multiUser = true;
        writeInput("\x1B[B\r");
        closeInputSoon();
    }
}

function mirrorAndAnswer(stream, output) {
    stream.on("data", chunk => {
        output.write(chunk);
        answerFromOutput(chunk);
    });
}

mirrorAndAnswer(child.stdout, process.stdout);
mirrorAndAnswer(child.stderr, process.stderr);

// Fallback for prompt output that is split across unusual chunks.
const fallbackTimers = [
    setTimeout(() => {
        if (!steps.url) {
            steps.url = true;
            writeInput(`${publishBaseUrl}\n`);
        }
    }, 500),
    setTimeout(() => {
        if (!steps.publishType) {
            steps.publishType = true;
            writeInput("\r");
        }
    }, 1_500),
    setTimeout(() => {
        if (!steps.multiUser) {
            steps.multiUser = true;
            writeInput("\x1B[B\r");
            closeInputSoon();
        }
    }, 2_500),
];

child.on("error", error => {
    console.error(`Failed to start wpsjs publish: ${error.message}`);
    process.exitCode = 1;
});

child.on("exit", code => {
    fallbackTimers.forEach(timer => clearTimeout(timer));
    if (closeInputTimer) {
        clearTimeout(closeInputTimer);
    }

    if (code === 0) {
        updateMacInstallScript(publishBaseUrl);
    }

    process.exitCode = code ?? 1;
});
