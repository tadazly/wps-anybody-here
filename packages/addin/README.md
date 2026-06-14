# 表里有人

> 看看表里谁在配，谁在改，谁在和你撞格子

WPS 表格加载项。打开表格后会自动加入协作房间，看到同表在线用户、远端选区和地址级冲突。

## 使用

1. 先启动 `@wps-anybody-here/server`。
2. 在 WPS 里加载本插件。
3. 第一次打开时会弹出协作设置窗口。
4. 填写服务器地址、表格仓库地址、本地仓库根目录和你的名字，然后保存。
5. 后续再打开 WPS 时不会重复弹出设置窗口，插件会自动加入协作。

默认服务器地址：

```txt
ws://127.0.0.1:18080
```

如果服务跑在发布机，把地址改为发布机内网 IP，例如：

```txt
ws://192.168.1.20:18080
```

表格仓库地址没有默认值，需要首次运行时填写。它用于标识这批表来自哪个 Git 仓库。本地仓库根路径用于把每个人电脑上的完整文件路径转换成仓库相对路径，例如：

```txt
D:\GameConfig\table
```

如果打开的是 `D:\GameConfig\table\version\military.xlsx`，插件会把它识别为：

```txt
version/military.xlsx
```

这样即使不同人把仓库放在不同盘符，也会进入同一个协作房间；如果仓库里存在不同目录下的同名表，也会按相对路径区分。

## 开发

```bash
pnpm install
pnpm --filter @wps-anybody-here/addin dev
pnpm --filter @wps-anybody-here/addin build
```

打包后资源会输出到 `dist/`。WPS 加载项仍使用 wpsjs 模板的入口结构：

- `index.html`
- `main.js`
- `ribbon.xml`
- `manifest.xml`
- `ui/taskpane.html`
- `js/taskpane.js`

## 注意

- 当前只处理单个单元格或退化成单个单元格的地址，大范围选区不会逐格高亮。
- 高亮暂时使用单元格底色，复杂表格样式后续建议改为边框方案。
- WPS 事件使用 `SheetSelectionChange` 和 `SheetChange`，需要结合实际 WPS 版本继续验证。
