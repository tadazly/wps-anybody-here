const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const addinDir = path.join(repoRoot, "packages", "addin");
const addinBuildDir = path.join(addinDir, "wps-addon-build");
const addinPublishDir = path.join(addinDir, "wps-addon-publish");

function argValue(name, alias) {
    const args = process.argv.slice(2);

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === name || arg === alias) {
            return args[index + 1];
        }

        if (arg.startsWith(`${name}=`)) {
            return arg.slice(name.length + 1);
        }
    }

    return args.find(arg => !arg.startsWith("-"));
}

function normalizePort(value) {
    const port = Number(value || 18080);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        console.error(`Invalid port: ${value}`);
        process.exit(1);
    }

    return port;
}

function removePreviousPublishOutput() {
    for (const dir of [addinBuildDir, addinPublishDir]) {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
            console.log(`Removed previous publish output: ${path.relative(repoRoot, dir)}`);
        }
    }
}

const port = normalizePort(argValue("--port", "-p") || process.env.PORT);
const publishBaseUrl = process.env.ADDIN_PUBLISH_URL || `http://127.0.0.1:${port}/addin/`;

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
    process.exitCode = code ?? 1;
});
