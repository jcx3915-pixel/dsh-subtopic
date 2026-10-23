# dsh-subtopic 安装教程

给 **DeepSeek Harness（DSH）** 装一个第三方插件：选中一段文字 → 按一下热键 → 就地弹出「子话题」卡片解释这一段，并沉淀成右侧追问树。

插件是**两半**，理解这一点能省掉一半的排查时间：

| 半 | 文件 | 作用 | 改完怎么生效 |
| --- | --- | --- | --- |
| 宿主半 | `lib/host.js` | 注册 `/ext/subtopic/*` 路由、调用 `llm.stream()`、provider 回退 | **必须重启 DSH 进程** |
| 客户端半 | `lib/client.js` | 选区/胶囊/卡片/追问树/引用卡片/设置页 | Ctrl+R 刷新页面即可 |

没有依赖、没有构建步骤：两个 `.js` 是成品，`link:` 装进去就能跑。

---

## 0. 前置条件

- 已装好并能打开 **DSH 桌面版**（本教程在 Windows 的 `desktop` profile 上实测）。
- 知道你要装进哪个 profile：默认是

  ```
  Windows : %USERPROFILE%\.dsh\profiles\desktop
  macOS/Linux: ~/.dsh/profiles/<profile>
  ```

  不确定就看 `~/.dsh/profiles/` 下面有哪些目录，装进你日常在用的那个。
- 有 `git`（没有也行，见第 1 步的 zip 方案）。
- 需要 `pnpm` 跑一次安装：DSH 运行时自带一份，不要求全局安装（见第 4 步）。

---

## 1. 把源码放进 profile

Windows PowerShell：

```powershell
$profile = "$HOME\.dsh\profiles\desktop"          # 换成你的 profile
git clone https://github.com/jcx3915-pixel/dsh-subtopic.git "$profile\.dsh-subtopic-source"
```

macOS / Linux（bash/sh）：

```bash
profile="$HOME/.dsh/profiles/desktop"
git clone https://github.com/jcx3915-pixel/dsh-subtopic.git "$profile/.dsh-subtopic-source"
```

**没有 git**：在 GitHub 页面点 `Code → Download ZIP`，解压后把文件夹改名为 `.dsh-subtopic-source` 放进 profile 目录即可。

装完检查一眼，应该有这些：

```
<profile>\.dsh-subtopic-source\package.json
<profile>\.dsh-subtopic-source\cordis.patch.yml
<profile>\.dsh-subtopic-source\lib\client.js
<profile>\.dsh-subtopic-source\lib\host.js
```

> 目录名可以随便取，但下面 `package.json` 里的 `link:` 值要跟着改。

---

## 2. 在 profile 的 `package.json` 里登记

> 注意：要改的是 **profile 目录下**的 `package.json`（DSH 用它的 `dsh.profile.bundles` 决定加载哪些插件），**不是**插件目录里那份。

打开 `<profile>\package.json`，加**两处**：

```json
{
  "name": "dsh-profile-desktop",
  "private": true,
  "dependencies": {
    "dsh-subtopic": "link:.dsh-subtopic-source"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-subtopic"
      ]
    }
  }
}
```

两条缺一不可，原因不同：

- `dependencies` 里的 `link:` 决定 `node_modules/dsh-subtopic` 指向哪个目录（Windows 上是一个 Junction，等于"原地开发、免拷贝"）。
- `dsh.profile.bundles` 才是**真正让 DSH 加载它**的地方。名字必须和插件 `package.json` 里的 `name` 完全一致：`dsh-subtopic`。

改之前建议留个备份（`package.json.bak`、`pnpm-lock.yaml.bak`），出问题直接换回来。

---

## 3. 建好链接：跑一次 `pnpm install`

```powershell
cd "$HOME\.dsh\profiles\desktop"
pnpm install
```

`pnpm` 不在 PATH 上？用 DSH 运行时自带的（不用全局装）：

```powershell
$rt = "$HOME\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies"   # 目录名以你机器上实际的为准
& "$rt\node\bin\node.exe" "$rt\pnpm\bin\pnpm.mjs" install
```

装完验证一下链接确实建好了：

```powershell
Get-Item "$HOME\.dsh\profiles\desktop\node_modules\dsh-subtopic" |
  Select-Object Name, LinkType, Target
```

期望输出（`Target` 就是第 1 步那个源码目录）：

```
Name          LinkType  Target
----          --------  ------
dsh-subtopic  Junction  {C:\Users\<你>\.dsh\profiles\desktop\.dsh-subtopic-source}
```

macOS / Linux 上是 symlink，`ls -l node_modules/dsh-subtopic` 看到 `-> ../.dsh-subtopic-source` 就对了。

---

## 4. 重启 DSH

- **宿主半**（路由、模型调用）：**必须完全退出 DSH 再打开**。关窗口可能只是最小化到托盘，确认进程真的退出了。
- **客户端半**：重启后只要刷新页面（Ctrl+R / ⌘R）就会换成最新代码，之后改 `lib/client.js` 都不用再重启。

> 为什么宿主半不能靠"重新启用插件"代替重启：ESM 的模块命名空间会被缓存，重新应用拿到的仍是旧模块（路由会短暂 404 再回来，但代码是旧的）。这是 DSH 0.1.x 的行为，不是本插件的 bug。

---

## 5. 验证装好了

1. 打开任意会话，**选中一段文字**——选区右下角出现 `Ctrl 子话题解答` 胶囊。
2. 按一下 `Ctrl` 再松开（1.2 秒内、不按别的键）→ 旁边弹出「子话题」卡片并开始流式回答。
3. 打开 **设置**，左侧导航里多了一页 **子话题**（改热键、改卡片与树面板颜色）。

想从接口层面确认（端口以你地址栏里的为准，这里是 19387）：

```bash
python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:19387/ext/subtopic/info',timeout=8).read().decode())"
```

期望返回 `{"ok":true,"hasLlm":true,...}`。`hasLlm:false` 表示模型服务没接上，卡片会报"模型没有返回任何内容"。

---

## 6. 更新到新版本

```powershell
cd "$HOME\.dsh\profiles\desktop\.dsh-subtopic-source"
git pull
```

- 只动了 `lib/client.js` → 刷新页面。
- 动了 `lib/host.js` / `package.json` / `cordis.patch.yml` → 重启 DSH。

---

## 7. 卸载

```powershell
$profile = "$HOME\.dsh\profiles\desktop"
Remove-Item -Recurse -Force "$profile\node_modules\dsh-subtopic"     # 链接
Remove-Item -Recurse -Force "$profile\.dsh-subtopic-source"          # 源码
```

再从 `<profile>\package.json` 的 `dependencies` 与 `dsh.profile.bundles` 里删掉 `dsh-subtopic`，重启 DSH。

浏览器里还有三份数据（`dsh-subtopic-tree` 追问树、`dsh-subtopic-ui` 面板宽度/折叠、`dsh-subtopic-prefs` 热键与颜色），卸载插件不会自动清掉；在开发者工具的 Application → Local Storage 里删即可。

---

## 8. 常见问题

**`/ext/subtopic/info` 返回 404 —— 插件没被加载**

按顺序查：`dsh.profile.bundles` 里有没有 `dsh-subtopic` → `node_modules\dsh-subtopic` 在不在 → 有没有重启 DSH 进程。

**选中文字不出现胶囊**

客户端半没下发。看 `/ext/subtopic/graph` 的 `hasSubtopic` 是不是 `true`，然后刷新页面；仍不行就确认 profile 里 bundle 写对了、重启一次。

**卡片转一圈后说"模型没有返回任何内容"**

这几乎总是 **provider 路由**问题，不是提示词问题：`llm.stream()` 不抛错，失败是以一个终结的 `finish` 错误块返回的。随附的默认配置指向 `deepseek-official`，在已登录账号的桌面部署里这条路线没有凭据。插件会自动按 `deepseek-account → agentDefaultModel → 配置里 pin 的 provider` 的顺序换路线，卡片的模型标签会显示实际用的那个。想钉死就用宿主半 config：

```yaml
- id: subtopic
  name: dsh-subtopic
  config:
    provider: deepseek-account
    model: deepseek-flash
```

**改了 `lib/host.js` 但行为没变**

ESM 缓存，必须重启 DSH 进程（见第 4 步）。

**设置页在导航里是个通用齿轮，没有自己的图标**

`settings.section` 的注册契约只投影 `id` / `order` / `label`，拿不到图标——所有第三方设置页在 DSH 0.1.x 里都长这样，不是安装问题。

**热键能不能换成别的键？**

能，在 设置 → 子话题 里录制：支持 `Ctrl` / `Alt` / `Shift` / `⌘`（可组合）和 `F1`–`F12`。单字母会被拒绝（打字时会误触发）。

---

## 9. 发布到 GitHub（作者自己的一节）

这份目录本身就是可直接推上去的仓库。三条路，按你机器上有什么选：

**A. 命令行（装了 Git 最省事）**

```powershell
cd "$HOME\Desktop\dsh-subtopic"
git init -b main
git add -A
git commit -m "dsh-subtopic 0.1.0"
git remote add origin https://github.com/jcx3915-pixel/dsh-subtopic.git
git push -u origin main
```

没装 Git 就先装 [Git for Windows](https://git-scm.com/download/win)（或 `winget install Git.Git`），重开一个终端让 PATH 生效。

**B. GitHub Desktop**（不想碰命令行）：装 [GitHub Desktop](https://desktop.github.com/)（自带 git）→ `File → Add local repository` 选这个目录 → `Publish repository`。

**C. 完全不用装工具**：在 GitHub 上先建一个空仓库（不要勾 README / .gitignore），进入仓库页面 → `Add file → Upload files` → 把 `dsh-subtopic` 目录里的**内容**（`lib/`、`test/`、`docs/`、`README.md`、`INSTALL.md`、`LICENSE`、`package.json`、`cordis.patch.yml`、`.gitignore`）拖进去 → `Commit changes`。拖文件夹会保留目录结构；`.gitignore` 这类以点开头的文件如果被系统隐藏，先在资源管理器里打开"显示隐藏文件"。

推之前顺手做两件事：

1. 确认所有文档里的仓库地址都是你自己的（`README.md` 的安装段、本文件的第 1 步）。
2. 想发 npm 的话，`package.json` 里 `name` / `version` / `license` / `files` / `repository` 都已就绪（`private` 已去掉），确认后 `npm publish` 即可。

### 发布之后：别人怎么装

推上去（并**打一个 tag**，例如 `v0.1.0`）之后，别人不需要你这份目录，直接让 DSH 装就行——DSH 的安装入口本来就接受"安装 spec"：

```bash
# 命令行（等价于 GUI 里"设置 → 内置插件 → 安装"填同一串）
dsh plugin --profile desktop add github:jcx3915-pixel/dsh-subtopic#v0.1.0
```

也可以在 DSH 里直接说一句"帮我装 `github:jcx3915-pixel/dsh-subtopic#v0.1.0`"（或给它仓库地址），**让 DSH 自己下载部署**：安装器认这些写法——`github:owner/repo#tag`、`git+https://github.com/owner/repo.git`、`git@github.com:owner/repo.git`、`gitlab:` / `bitbucket:`，以及 npm 包名。装完**重启 DSH**（宿主半是 ESM，必须重启，见第 4 步）。

几点值得先知道：

- **一定要带 tag**。`github:owner/repo` 不带 tag 装的是默认分支当时的快照，既没法锁版本也没法说清装的是哪一版；`#v0.1.0` 才能复现。
- **从 git / npm 装是"拷贝"而不是"链接"**：装完 `node_modules/dsh-subtopic` 是一份副本，你改了源码别人得重装（第 6 步那种 `git pull` 只适用于第 1～3 步的 `link:` 装法）。自己开发仍然推荐 `link:`（第 2、3 步）。
- **本插件零构建**：`package.json` 里没有 `prepare` / `build` 脚本，`lib/` 是两个手写成品文件——所以从 GitHub 直装不会出现"装到一半去跑构建"的坑，也不受目录审核里那条"发现安装生命周期脚本：prepare"的风险提示影响。
- **没写 `peerDependencies`**：DSH 装插件时会拿它做兼容性检查，写错范围反而会被**拒绝安装**；这里故意留空，只靠 `dsh.bundle.patch` + `dsh.client.inject` 声明形态。
- **想上插件市场**：市场不是一个"提交审核"的仓库，而是聚合几个目录（`dsh.so`、`dsh.works`、岚叔目录、`awesome-dsh-plugin`、npm 搜索、以及 GitHub 的 `dsh-plugin` topic）。所以要被搜到，做两件事就够：仓库开源并打上 **`dsh-plugin` topic**（外加 `dsh` / `deepseek-harness` 之类关键词），或者发到 **npm**；市场的一键安装底层也是 pnpm 装上面那个 spec，装法完全一样。
- **`npm publish` 前**：`dsh-subtopic` 这个无 scope 名字可能已被占用，被占就换成 `@你的scope/dsh-subtopic`（同时改第 2 步 `dsh.profile.bundles` 里的名字）。

仓库里自带离线自测，clone 下来不用装依赖就能跑（零构建、不连网、不需要 DSH 在运行）：

```bash
node test/client-smoke.mjs   # 加载 + apply + 槽位注册
node test/client-flow.mjs    # 完整交互链路（138 项断言）
node test/host-half.mjs      # 宿主半：路由 / provider 回退 / 帧协议（36 项断言）
npm test                     # 三个一起跑
```
