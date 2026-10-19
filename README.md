<h1 align="center">
  <a href="https://github.com/xun404/pihuo-agent">
    <img src="docs/assets/icon.png" alt="Pi活儿" width="64" valign="middle" />
  </a>
  Pi活儿
</h1>

<p align="center">
  <sub><a href="docs/readme/README.en.md">English</a></sub>
</p>

<p align="center">
  <a href="https://github.com/xun404/pihuo-agent/releases/latest">下载</a>
</p>

<p align="center">
  <img src="docs/assets/readme-hero.webp" alt="Pi活儿桌面，中文首页" width="960" />
</p>

Pi活儿是一个本地桌面应用。你说出要做的事，Pi Leader 把它拆开并派出去，本机上的 Worker 把活干完。

Leader 使用 [Pi coding agent](https://pi.dev/)，但只做编排：不分析项目，不设计方案，不改文件。Worker 通过 [Agent Client Protocol](https://agentclientprotocol.com/) 接进同一个会话，用你本机已经安装的 Agent 执行。安装包不带这些 CLI。

你得到的是一块指挥台。任务怎么拆、派给谁，由 Leader 按当前会话的 Team 安排；代码、命令和文件操作发生在 Worker 侧。设置、密钥和会话留在本机，不需要云账号。

设计上，编排和执行分开。Leader 负责派发和转达，Worker 负责做事，用谁由你决定。权限停在当前会话，不是操作系统沙箱。

[MIT License](./LICENSE)
