# Scripts

这里放项目发布和维护辅助脚本。日常命令以根目录 `package.json` 为准。

## `publish-addin.js`

从 `packages/addin/` 调用 `wpsjs publish`，自动完成 WPS 发布向导输入。

执行前会删除旧发布产物：

- `packages/addin/wps-addon-build/`
- `packages/addin/wps-addon-publish/`

随后填入：

- 服务器地址：`http://127.0.0.1:<port>/addin/`
- 发布类型：在线模式
- publish 页面多用户使用：是

默认端口是 `18080`：

```bash
npm run publish:addin
```

自定义端口：

```bash
npm run publish:addin -- 18081
```

或先设置 `PORT`。发布端口必须和协作服务启动端口一致。
