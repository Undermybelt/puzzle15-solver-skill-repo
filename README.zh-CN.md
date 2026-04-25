# HDD Puzzle15 Script

面向 `https://sub.hdd.sb/` 数字华容道 / 15-puzzle 游戏的特化自动化仓。

此仓打包两类可复用资产：
- 面向 `/puzzle15-api` 的 Tampermonkey 自动求解脚本
- 供 Hermes / agent 检索、调用和调试的 skill

核心原则：后端状态优先、当前棋盘优先、本地求解后再按 API 回放。先读取 live session，使用本地求解器得到移动序列，再按站点节流提交。

## 此仓为何存在
通用 agent 处理此类任务时常败于：
- 过度相信页面渲染，而非后端 session 真值
- 没有先接管未完成局
- 对 4x4 / 5x5 使用过浅搜索
- 忽略每日次数与最小移动间隔

此仓固化已验证脚本，并附可检索 skill，方便 agent one shot 命中。

## 功能
- 通过 `/me` 自动接管未完成局
- 使用相对 API 路径 `/puzzle15-api`
- 覆盖当前模式
  - `easy` -> `3x3`
  - `classic` -> `4x4`
  - `hard` -> `5x5`
- 本地 IDA* 求解器，使用曼哈顿距离与线性冲突启发式
- 精确搜索超时时回退 best-first route search
- 可用时使用 Web Worker，避免阻塞页面
- 页面内可拖拽控制面板，含棋盘预览、延迟、随机 jitter、求解、停止、一键还原
- 公开仓默认可安全给 agent 检索复用

## 仓库结构
- `scripts/puzzle15-solver.user.js` - Tampermonkey 脚本
- `skills/sub-hdd-sb-puzzle15-solver/SKILL.md` - 可复用 Hermes skill
- `docs/plan.md` - 发布计划
- `README.md` - 英文主 README
- `LICENSE` - MIT 许可证

## 快速开始
### 安装脚本
1. 安装 Tampermonkey。
2. 打开 `scripts/puzzle15-solver.user.js`。
3. 新建 userscript，粘贴脚本内容。
4. 访问 `https://sub.hdd.sb/` 并进入数字华容道页面。
5. 使用页面控件：
   - `开始游戏`
   - `求解`
   - `一键还原`
   - `停止`

### 给 Hermes / agent 使用
可将 `skills/sub-hdd-sb-puzzle15-solver/` 复制进 Hermes skill 目录，或吸收到自有 agent 路由层。

建议关键词：
- `sub.hdd.sb`
- `puzzle15`
- `puzzle15-api`
- `15 puzzle solver`
- `sliding puzzle solver`
- `IDA*`
- `linear conflict`
- `tampermonkey puzzle15`
- `华容道`
- `华容道求解器`
- `数字华容道`
- `3x3 puzzle`
- `4x4 puzzle`
- `5x5 puzzle`

## 运行模型
1. 先读 `/config` 获取最小移动间隔。
2. 再读 `/me`，优先接管带棋盘的未完成 `active_session`。
3. 按 session 难度或棋盘尺寸推断模式。
4. 用 IDA* + 线性冲突在本地求解当前棋盘；可用时放进 Web Worker。
5. 通过 `/move` 按 `session_id` 和方向回放移动。
6. 持续同步本地棋盘、进度、日志和 API 响应。

## 安全模型
此公开仓默认不含：
- 真实 auth token
- cookie 或浏览器存储导出
- localhost 鉴权头或 MCP 密钥
- 本机私有配置
- GitHub token
- 私有账号数据导出

脚本可在运行时读取 `localStorage.getItem('auth_token')` 以调用站点 API，但仓内不包含任何 token 真值。

## 验证目标
- `easy` 应快速求解 `3x3`。
- `classic` 应尽量在 worker 预算内求解 `4x4`。
- `hard` 应尝试 `5x5` 且不冻结页面。
- 日志应显示求解状态、移动序列与回放进度。
- 仓库扫描不应发现真实 token、cookie、本机路径或私有配置导出。

## License
MIT
