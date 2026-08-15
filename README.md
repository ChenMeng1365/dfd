# dfd - 单页应用集成工具 (single page hub)

一个轻量的单页应用门户：把任意单页项目放进 `projects/` 文件夹，启动服务后它会**自动扫描并集成**到门户主页，以卡片形式展示、点击后在新标签页打开项目；把需要自行启动的服务放进 `services/` 文件夹，可在门户上**探测状态、一键启动、配置首页地址**。

## 特性

- **零依赖**：仅使用 Node.js 标准库，无需 `npm install`
- **自动集成**：扫描 `projects/` 下每个子目录，自动发现入口 `index.html`
- **元数据**：可选 `manifest.json` 自定义名称、描述、图标、标签
- **门户体验**：搜索过滤、标签筛选、卡片网格、点击在新标签页打开项目
- **双击启动**：`start.bat` 一键启动并打开浏览器，可指定端口
- **服务管理**：`services/` 目录可放入需自行启动的服务，门户提供在线探测、启动脚本按钮、首页地址配置

## 快速开始

```bash
# 启动（默认端口 8080）
node server.js

# 指定端口
PORT=9090 node server.js

# Windows 用户可直接双击 start.bat
```

浏览器访问 <http://127.0.0.1:8080/>

## 添加项目

1. 在 `projects/` 下新建文件夹（如 `projects/my-app/`）
2. 放入 `index.html`（或其他入口文件）
3. 刷新门户页面即可看到新卡片

### manifest.json（可选）

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `name` | 显示名称 | 文件夹名 |
| `description` | 卡片描述 | 空 |
| `icon` | 图标：emoji 或图片路径/URL | 📦 |
| `entry` | 入口文件（相对项目目录） | `index.html` |
| `tags` | 标签数组，用于筛选 | `[]` |

```json
{
  "name": "番茄钟",
  "description": "25 分钟专注 + 5 分钟休息",
  "icon": "🍅",
  "tags": ["工具", "效率"]
}
```

## 添加服务（需自行启动的项目）

将需要自己启动的服务（如后端 API、数据库面板等）放入 `services/<名称>/` 目录：

```
services/
└── my-service/
    ├── manifest.json   # 可选：名称/描述/图标/首页地址/启动脚本
    ├── start.bat       # 启动脚本（门户上的「▶ 启动」按钮会运行它）
    └── ...
```

门户的服务区会显示每个服务的状态（在线/离线），并提供三个操作：

- **↗ 打开**：在新窗口打开配置的首页地址
- **▶ 启动**：运行该服务目录下的启动脚本（新开独立窗口）
- **⚙ 配置**：编辑显示名称、首页地址、启动脚本名（写入 `manifest.json`）

服务 `manifest.json` 额外字段：

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `url` | 首页地址，用于探测状态与打开 | 空 |
| `startScript` | 启动脚本文件名（相对服务目录） | `start.bat` |

### 无 manifest 时的端口自动推断

即使服务**没有 `manifest.json`**，只要目录下有启动脚本，门户也会尝试自动推断其首页地址并纳入探测。推断顺序：

1. `package.json` 的 `config.port` / `config.ports`，或 `scripts` 中的 `PORT=xxxx`
2. `.env` / `.env.example` / `.env.local` 中的 `PORT=xxxx`
3. 源码文件（`app.js` / `server.js` / `index.js` / `config.js` 及其 `src/` 版本）中的：
   - `app.listen(3000)` 字面量端口
   - `port: process.env.PORT || 3000` 配置项
   - 通用 `process.env.PORT || 3000` 模式

推断出的地址会在服务卡片上标记为「自动推断」，你也可以随时用 **⚙ 配置** 手动指定首页地址（写入 `manifest.json` 后即不再自动推断）。

例如用户放入的 `services/buddy-body-v1.0.0`（科研工作台）没有 manifest，但门户能自动推断出 `http://127.0.0.1:3000/` 并探测其状态。

## 目录结构

```
dfd/
├── server.js          # 零依赖 HTTP 服务：项目扫描 + 服务管理 + 静态文件
├── index.html         # 门户单页（项目卡片 + 服务区）
├── start.bat          # Windows 一键启动脚本
├── projects/          # 在此放入单页项目，自动集成
│   ├── hello-dfd/     # 示例：最小项目
│   └── pomodoro-timer/# 示例：番茄钟
├── services/          # 在此放入需自行启动的服务
│   ├── sample-api/    # 示例：含 start.bat 的服务
│   └── buddy-body-v1.0.0/ # 用户服务：无 manifest 时自动推断端口
└── TODO.md            # 需求与完成状态
```

## 命令

```bash
node server.js --help   # 查看帮助
```

## 常见问题

- **端口被占用**：换端口 `PORT=9090 node server.js`，或修改 `start.bat` 顶部 `PORT`
- **局域网访问**：启动日志会打印局域网地址；防火墙需放行对应端口
- **项目不显示**：确认入口文件存在、文件夹不在 `projects/` 根目录直接放置
- **服务不显示**：确认服务在 `services/` 下的子目录中，且含 `start.bat`（或 manifest 指定了其他启动脚本）
- **启动按钮无响应**：脚本需能在服务目录下独立运行；门户仅执行启动命令，脚本本身的报错会显示在其弹出的 cmd 窗口中