# Scripts

这里放项目发布和维护辅助脚本。日常命令以根目录 `package.json` 为准。

## `publish-addin.js`

从 `packages/addin/` 调用 `wpsjs publish`，自动完成 WPS 发布向导输入。

执行前会删除旧发布产物：

- `packages/addin/wps-addon-build/`
- `packages/addin/wps-addon-publish/`

随后填入：

- 服务器地址：通过参数或环境变量传入的发布地址，默认本机测试为 `http://127.0.0.1:<port>/addin/`
- 发布类型：在线模式
- publish 页面多用户使用：是

发布成功后，脚本还会同步更新 `scripts/mac-install.sh`：`url` 写入本次 `/addin/` 发布地址，`install` 写入同源根地址，供 Mac 用户手动安装。

默认端口是 `18080`：

```bash
npm run publish:addin
```

给其他电脑使用时，传入其他电脑也能访问的 HTTP 地址。没有写路径时脚本会自动补成 `/addin/`：

```bash
npm run publish:addin -- --url http://splan.61.com
npm run publish:addin -- --url http://192.168.1.20:18080
```

自定义端口：

```bash
npm run publish:addin -- --url http://192.168.1.20:18081
```

也可以使用 `ADDIN_PUBLISH_URL` 或 `PORT` 环境变量。发布地址必须和协作服务启动地址一致。
