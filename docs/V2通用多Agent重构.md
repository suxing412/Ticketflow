# V2 通用多 Agent 重构

本文件记录从游戏工作室流水线迁移到通用软件项目多 Agent 平台的协议。V1 游戏流程仍可通过
`套件/studio.config.game.template.json` 使用；新安装默认采用 `software-project` Profile。

## 本阶段已经落地

完整执行链现在是：Orchestrator 产出机器可读计划 → 确定性内核校验 DAG 并生成子工单 → 动态路由
选择 Provider → 每张执行单在独立 Git worktree 中完成并形成检查点 → Reviewer 读取同一检查点 →
Integrator 按依赖提交合并和验证 → 用户确认后 fast-forward 发布到项目当前分支。

### 角色与厂商解耦

工单通过 `role` 表达所需角色，通过 `required_capabilities` 表达硬能力要求。`职能` 字段作为旧 UI
兼容字段保留。Agent 可以使用 `routing.mode=auto` 自动选择 Provider，也可以临时固定：

```yaml
role: backend
required_capabilities: [coding, backend]
routing:
  mode: auto
```

实际领单后，系统把选择结果写入工单的 `provider`、`路由分` 和兼容字段 `执行池`。一次执行期间不换
Provider；失败重投或下一张工单会重新评分。

### Provider Adapter

当前内置三种 Adapter：

- `codex-cli`：调用 Codex 无头 CLI。
- `claude-cli`：调用 Claude Code 无头 CLI。
- `command-cli`：通过声明命令、固定参数和模型参数接入其他厂商 CLI，例如 Kimi。

Provider Adapter 只负责生成进程调用，不参与工单状态、角色判断和调度。Kimi 默认关闭；确认本机
命令、参数和模型名后，在 `studio.config.json` 中启用，调度层无需改代码。

### 动态路由

路由分两步：

1. 硬过滤：启用状态、角色范围、所需能力、手动允许/禁止名单。
2. 评分：配置质量分、该角色近期真实成功率、延迟分、成本分和角色偏好。

真实评审结论优先于 CLI 退出码进入成功率。Reviewer 默认避开原实现 Provider，只有没有替代者时才
回到同一 Provider。试跑记录不会污染真实评分。

可通过 `GET /api/providers` 查看 Provider、角色候选排序、选择理由和最近执行记录。

### Orchestrator 与确定性 DAG

Orchestrator 的自然语言回复末尾必须带一个 JSON 计划。AI 负责提出拆分；内核负责验证角色、任务数量、
依赖引用、循环依赖、写入范围和递归 Orchestrator 禁令。验证全部通过后才会创建稳定编号的待投子工单；
重规划不会覆盖已经开工的子单。

```json
{
  "summary": "先契约、再并行实现、最后集成",
  "tasks": [
    {
      "key": "backend",
      "title": "实现 API",
      "role": "backend",
      "dependsOn": [],
      "requiredCapabilities": ["coding", "backend"],
      "writeScope": ["server/**"],
      "acceptance": ["契约测试通过"]
    }
  ]
}
```

### Git worktree 隔离与集成

- 实弹执行时，每张工单使用稳定分支 `studio/<project>/<ticket>` 和独立目录；断点恢复会复用原 worktree。
- Agent 结束后系统统一 `git add/commit` 形成检查点；Agent 自己不切分支、不推送。
- `write_scope` 存在时，非 Integrator 工单的越界改动会在提交前被拒绝并进入失败分诊。
- QA、代核读取原执行 worktree，不会在主项目上评审一个尚未发布的版本。
- 有依赖的执行单开工前会先纳入上游检查点，保证 Backend、Frontend、Reviewer 看到的不是旧基线；缺少检查点会被拒绝。
- Integrator 开工前同样按依赖提交逐个合并。只有 Integrator 的冲突会保留在自己的 worktree，并将冲突文件写进提示词；其他角色遇到冲突直接进入失败分诊。
- 主项目发布是详情页的人工动作，而且只允许无脏改动、无分叉的 fast-forward；否则拒绝并要求重新集成。

worktree 是并发写隔离，不是安全沙箱。Provider CLI 仍拥有本机进程权限，因此只应注册允许 AI 访问的项目。

### 通用软件 Profile

默认角色：

- `orchestrator`：拆解目标、建立任务依赖和接口契约。
- `backend`：服务端、数据与测试。
- `frontend`：页面、交互与前端测试。
- `reviewer`：跨 Provider 只读复核。
- `integrator`：合并与项目级验证。

默认阶段为 `PLAN → BUILD → VERIFY`。角色协议位于安装目录的 `角色协议/`，修改后下一张工单生效。

## V2 配置要点

```json
{
  "profile": "software-project",
  "providers": {
    "codex": { "adapter": "codex-cli", "enabled": true },
    "claude": { "adapter": "claude-cli", "enabled": true },
    "kimi": {
      "adapter": "command-cli",
      "enabled": false,
      "command": "kimi",
      "args": [],
      "modelArgs": ["--model", "{model}"]
    }
  },
  "routing": {
    "crossProviderReview": true,
    "weights": { "quality": 0.5, "success": 0.3, "latency": 0.1, "cost": 0.1 }
  },
  "orchestration": {
    "maxTasks": 20,
    "allowNested": false
  },
  "workspace": {
    "mode": "worktree",
    "root": "workspaces",
    "branchPrefix": "studio",
    "autoCommit": true,
    "integrateDependencies": true,
    "allowMissingDependencies": false
  }
}
```

Provider 凭据不写入该文件。CLI Adapter 复用对应 CLI 已登录状态；后续 API Adapter 只允许保存环境变量
名称或系统凭据引用。

## 旧配置兼容

没有 `providers` 的 V1 配置会自动把 `执行池.codex` 和 `执行池.claude` 映射到同名 Adapter。旧 Agent
的 `执行池` 被视为固定 Provider，原工单和 UI 不需要一次性迁移。

要让某个旧 Agent 进入自动路由，可清除其 `执行池` 并增加：

```json
{ "routing": { "mode": "auto" } }
```

## 后续演进

1. 增加可定期运行的同题基准集，让 Provider 质量分不只依赖真实工单历史，也能主动感知厂商模型升级。
2. 实现受预算和次数限制的执行失败自动换 Provider，并区分代码失败、环境失败和模型能力失败。
3. 将接口契约类型提升为一等工件，提供 OpenAPI、JSON Schema 和共享类型的自动校验器。
4. 增加 worktree 生命周期管理：磁盘告警、已发布分支的可恢复清理和长期任务快照。
5. 增加 API Adapter 与凭据引用层；Provider 凭据仍不得进入明文工单或配置。
