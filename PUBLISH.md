# 发布与收录（PUBLISH）

这份文档回答两件事：**怎么发版**，以及**怎么让插件出现在市场 / 目录里**。

插件市场不是"提交审核"制。它由几个公开目录聚合，绝大多数目录只认两个信号：

1. **GitHub 仓库打了 `dsh-plugin` topic**（自动扫描）；
2. **npm 上有一个包**（最快、最权威）。

我们已经有 ①，还没有 ②。

## 当前状态

| 项 | 状态 |
| --- | --- |
| GitHub 仓库 + `dsh-plugin` topic | ✅ 有（topic 实时搜索已能搜到） |
| `v0.1.0` tag / Release | ✅ 有 |
| npm 包 `dsh-subtopic` | ❌ 未发布（名字在 registry 上仍是 404，可用） |
| dsh.so 验证等级 | 未提交 |
| awesome-dsh-plugin | 未提交 |
| radar 登记表 | 未提交（topic 也会被每日扫描收录） |

---

## 一、发 npm（最高杠杆）

名字 `dsh-subtopic` 没被占用。发布后：市场里"安装它"从 `github:…` 变成干净的 `dsh-subtopic`，npm 源即时可见，其它目录也会读到版本号。

```powershell
cd C:\Users\28689\Desktop\dsh-subtopic
pnpm login                 # 浏览器里授权一次
pnpm publish --no-git-checks
```

**发布前逐项确认**（当前 `package.json` 已满足，改版时别破坏）：

- `version` 变了（`0.1.0` → 下一次 `0.1.1`），并且**不要**重复发布同一版本号。
- `files` 只含 `lib/` + 文档；`private` 字段不存在（否则 publish 直接被拒）。
- **没有** `preinstall` / `install` / `postinstall` / `prepare` / `prepublishOnly` —— 生命周期脚本会被目录标成"审核风险"。
- **不写** `peerDependencies`（写错范围会被兼容性检查拒装；本插件只依赖 `ctx.get()` 与宿主注入的 `react`，零 npm 依赖）。
- `LICENSE` 存在、`README.md` 里有安装命令。
- 声明了 `dsh.bundle`（不只是 `dsh.client`）—— 这是"可安装"的硬条件，也是投稿被拒最常见的原因。

**发布后**：

```powershell
cd C:\Users\28689\Desktop\dsh-subtopic
git tag v0.1.1              # 有 git 时；没有就在 GitHub 网页上建 Release
pnpm version patch --no-git-tag-version   # 下一版要发时再跑
```

装法随之变成：

```powershell
dsh plugin --profile desktop add dsh-subtopic
```

---

## 二、收录入口一览

| 目录 | 入口 | 怎么进 | 我们该做什么 |
| --- | --- | --- | --- |
| GitHub topic 实时搜索 | `api.github.com/search/repositories?q=… topic:dsh-plugin` | 实时 | ✅ 已完成；建议再补一个复数 topic `dsh-plugins`（另一条搜索会用到） |
| npm | registry.npmjs.org | 实时 | 跑第一节 |
| **dsh.so** | https://www.dsh.so/submit | 填仓库地址或 npm 名，自动扫描 | 提交一次，拿 L1–L5 + 安全等级 |
| **awesome-dsh-plugin** | `awesome-dsh-plugin/awesome-dsh-plugin` 的 `data/plugins/<owner>__<repo>.yml` | 提一个 PR（**只加一个 YAML 文件**） | 用第三节的现成文件 |
| **radar** | `AdamPlatin123/dsh-plugin-radar` 的 `PLUGINS.md` | 提 PR 加一行，或等 topic 每日 02:00 扫描 | 用第三节的现成表格行 |
| 岚叔目录 | https://dsh.lanshuagent.com/api/plugins | 每 12 小时自动同步 topic 仓库 + 候选队列 | 不用操作 |
| dsh.works | https://dsh.works/awesome-dsh-plugins/plugins.json | 自动扫描约 1.7 万个 topic 仓库并**实测安装路径** | 不用操作 |

时间预期：npm 与 GitHub topic 即时；dsh.so 提交后当天到次日；其余自动扫描 12–24 小时一轮。

---

## 三、可直接复制的投稿文案

### 3.1 awesome-dsh-plugin（一个 YAML 文件 = 全部投稿）

新建 `data/plugins/jcx3915-pixel__dsh-subtopic.yml`：

```yaml
url: https://github.com/jcx3915-pixel/dsh-subtopic
name: jcx3915-pixel/dsh-subtopic
category: ui
description:
  en: Select text in a DSH conversation and tap Ctrl to get a sub-topic card with a streaming answer, a follow-up tree and drag-to-quote reference chips.
  zh: 选中对话里任意一段文字，按一下 Ctrl 就地开出子话题卡片：流式解答、追问树、拖拽成引用的卡片。
```

规则提醒（来自它的 `contributing.md`）：

- `url` 必须与仓库完全一致；`name` 用 `owner/repo`。
- 只有 `description.en` 必填，`zh` 可选；**描述里出现半角 `: `（冒号+空格）必须整段加引号**（上面这版没有，安全）。
- `category` 从固定取值里选，`ui` 用于界面类插件。
- 两个 README 是脚本生成的，**不要手工编辑**；也不需要本地跑生成脚本。

### 3.2 radar 表格行（追加到 `## 🔌 单插件` 表格末尾）

```markdown
| dsh-subtopic | [jcx3915-pixel/dsh-subtopic](https://github.com/jcx3915-pixel/dsh-subtopic) | 选中对话里任意一段文字按 Ctrl 就地开出子话题卡片：流式解答、追问树（串联/并联）、树行拖拽成引用卡片（模型收到完整原文）、设置可改热键与卡片/树面板颜色；纯 JS 零依赖零构建 | 待测 |
```

它的约定：插件名与 repo 名一致（✅ `dsh-subtopic`）；仓库打 `dsh-plugin` topic（✅）；`运行级` 一列由他们实测后填，投稿时写 `待测`。

### 3.3 dsh.so 提交框

```
https://github.com/jcx3915-pixel/dsh-subtopic
```

（也可以填 npm 名 `dsh-subtopic`，等第一节发完再提交更完整。）

### 3.4 通用双语一句话（给任何需要填"说明"的地方）

- 中：`选中对话里任意一段文字，按一下 Ctrl 就地开出子话题卡片：流式解答、追问树、拖拽成引用卡片。`
- EN: `Select text in a DSH conversation, tap Ctrl, and a sub-topic card explains it — streaming answer, follow-up tree, drag-to-quote chips.`

---

## 四、扫描 / 评审会看什么

dsh.so 的三条硬性闸门（本地已用 `market_selfcheck.py` 模拟跑过，结论 **PASSES**）：

| 闸门 | 要求 | 我们的情况 |
| --- | --- | --- |
| 插件 id | 匹配 `^[a-z0-9]+(-[a-z0-9]+)*$` | `dsh-subtopic` ✅ |
| 可扫源码 | 仓库里有可分析的 JS/TS/脚本 | 5 个 JS 文件，177,827 B ✅ |
| 安全扫描 | 无阻塞级发现（硬编码密钥、外传端点、破坏性操作、挖矿） | 无 ✅；6 条 warning 全在文档里的示例命令 |

warning 级 6 条的来源，评审看到时的说法：

- `INSTALL.md` / `README.md` 里的 `Remove-Item -Recurse` —— 是**卸载步骤**的示例命令，不是插件运行时行为。
- `INSTALL.md` 里的 `npm publish` —— 是**作者发版步骤**，不是 postinstall 行为。

插件运行时代码的对外面只有：一个同源的 `fetch('/ext/subtopic/ask')`、`localStorage`、DOM 事件；没有子进程、没有文件系统写入、没有第三方域名请求。

其它目录的关注点：

- **生命周期脚本**：无（有就会被标"审核风险 medium"）。
- **peerDependencies**：无（写了容易被兼容性检查拒装）。
- **锁定 ref**：`dsh plugin add github:…` 不带 tag 装的是默认分支快照，所以**每个版本都要打 tag**（已有 `v0.1.0`）。
- **README 里要有安装命令**，否则收录后用户不知道怎么装。

---

## 五、每次发版的固定流程

1. 改代码 → `node test/client-smoke.mjs && node test/client-flow.mjs && node test/host-half.mjs`（或 `npm test`）。
2. 同步桌面副本（`lib/` 与文档），并在 GitHub 上用 Upload files 覆盖。
3. `package.json` 升版本 → 打 tag → 建 GitHub Release。
4. `pnpm publish --no-git-checks`（首次先 `pnpm login`）。
5. 不用逐个通知目录：npm 源即时，其余 12–24 小时内自动刷新；dsh.so 的表单可以在新版本后重提交一次以刷新验证。

## 六、怎么确认"已经收录"

- GitHub topic：`https://github.com/search?q=topic%3Adsh-plugin+subtopic&type=repositories` 能看到本仓库。
- npm：`https://www.npmjs.com/package/dsh-subtopic` 能打开。
- dsh.so：站内搜索 `dsh-subtopic`，详情页会显示验证等级与安全等级。
- dsh.works：`plugins.json` 里搜 `jcx3915-pixel/dsh-subtopic`，条目里有实测的安装路径与 `verifiedAgainst` 版本。
- 岚叔目录 / radar：站内或 `PLUGINS.md` 搜 `dsh-subtopic`。
