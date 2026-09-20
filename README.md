# 客户流失预警平台

面向电信客户留存场景的全栈演示平台。系统基于合成数据识别流失风险，提供客户诊断、风险名单筛选、收益仿真与名单导出能力。

> 本项目使用合成数据，仅用于产品、建模和工程演示；不应将其中的预测结果直接用于真实客户决策。

## 功能

- 经营总览：展示客户规模、风险分层、业务线趋势、模型指标和特征影响。
- 风险名单：按业务线、风险等级、区域及关键词筛选、排序和导出客户。
- 客户诊断：查看单客户风险评分、特征贡献、历史用量与账单变化，以及建议动作。
- 干预仿真：按渠道成本、效果、人数及预算估算干预规模和预期净收益。
- 模型评估：包含规则、逻辑回归、LightGBM 和离散时间生存模型基线，以及特征消融与 uplift 分析。

## 技术栈

- 后端：Python、FastAPI、Pandas、DuckDB、scikit-learn、LightGBM
- 前端：React、TypeScript、Vite、TanStack Query/Table、ECharts
- 部署：Docker Compose 或 FastAPI 托管前端构建产物

## 快速启动

项目支持两种启动模式：Docker Compose 用于可复现的部署与演示；本地启动适合修改前后端代码时快速调试。

### Docker Compose（部署或演示推荐）

确保 Docker Desktop 已启动后，在项目根目录执行：

```powershell
docker compose up --build -d
```

首次启动会构建镜像、安装依赖并训练或加载模型，完成后访问：

```text
http://127.0.0.1:8000
```

检查容器和健康状态：

```powershell
docker compose ps
docker compose logs -f retention
```

停止容器（保留模型缓存）：

```powershell
docker compose down
```

Compose 将 `data/raw` 以只读方式挂载到容器，并把可再生成的模型缓存保存在 Docker volume 中。服务只绑定 `127.0.0.1:8000`，默认不向局域网公开。

### 本地一体化启动（开发推荐）

在项目根目录执行：

```powershell
.\start.ps1
```

脚本会检查 Python 依赖、安装前端依赖、构建前端，并启动服务。随后访问：

```text
http://127.0.0.1:8000
```

按 `Ctrl+C` 停止服务。

### 前后端分开开发

先启动后端：

```powershell
python -m pip install -r backend\requirements.txt
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

再在另一个终端启动前端：

```powershell
cd frontend
npm ci
npm run dev
```

前端开发地址为 `http://127.0.0.1:5173`，Vite 会将 `/api` 请求代理至后端。

## 测试与构建

开发与测试环境：Node.js 24（至少 24.0，推荐当前维护版本）、Python 3.13。Windows 本地运行需要安装这两个运行环境；Docker 模式无需在宿主机安装 Python 或 Node.js。CI 使用 Node 24 与 Python 3.13。

在项目根目录安装后端依赖并运行后端与模型测试：

```powershell
python -m pip install -r backend\requirements.txt
python -m pytest -q
```

安装前端依赖，执行类型检查、组件测试和生产构建：

```powershell
cd frontend
npm ci
npm run typecheck
npm test
npm run build
```

组件测试使用固定的模拟接口响应，覆盖加载失败与重试、筛选分页与排序、空结果、客户选择与恢复、导出失败、渠道切换和预算校验。开发时可使用 `npm run test:watch` 持续检查。

在 `frontend` 目录运行真实浏览器测试：

```powershell
npx playwright install chromium
npm run test:e2e
```

Linux 首次安装浏览器时使用 `npx playwright install --with-deps chromium`，同时安装系统依赖。

端到端测试需要先完成 `npm run build`。它会自动启动独立的 FastAPI 服务，等待 `http://127.0.0.1:18000/api/health` 就绪后，用 Chromium 的桌面和手机视口测试真实业务流程：总览、名单筛选、CSV 导出、客户诊断、干预仿真与刷新恢复。手机视口是浏览器模拟，不代表真实手机或 Safari 兼容性验证。

请保持 `18000` 端口空闲；测试不会复用或停止现有 `8000` 服务。测试使用原始数据，独立模型缓存位于 `.runtime/e2e/`，本地测试输出位于 `output/playwright/test-results/`，这些文件均已忽略。新增测试不更换模型、不重新生成原始数据。

### 自动检查（GitHub Actions）

每次 push、pull request 或手动运行 `Platform checks` 时，GitHub Actions 会从锁文件安装依赖，依次运行类型检查、组件测试、后端测试、生产构建和桌面/手机浏览器测试。任一步失败会使本次检查失败；错误详情在对应步骤的日志中显示。

工作流不执行自动部署，不上传测试报告、截图、视频或运行缓存。仓库只保留测试源码和配置。默认不创建账号体系；本地演示继续直接访问。

## 项目结构

```text
backend/                 FastAPI 接口与模型查询引擎
frontend/                React 前端
data/raw/                合成客户、月度行为、流失与干预历史数据
tests/                   后端与模型行为测试
frontend/tests/          模拟接口的组件测试
frontend/e2e/            连接真实后端的浏览器测试
.github/workflows/       GitHub Actions 自动检查
generate_synthetic_data.py  合成数据生成脚本
compose.yaml             Docker Compose 配置
start.ps1                Windows 一体化启动脚本
```

## 数据与模型说明

- 数据集包含 30,000 名合成客户及 24 个月的行为记录。
- 前 18 个月为特征观测期，后 6 个月为流失标签期。
- 模型缓存默认保存在本地 `.runtime/`，它可自动再生成，不应提交到版本库。
- 客户导出、截图、前端构建产物和测试报告同样属于运行产物，已通过 `.gitignore` 排除。

### 合成数据下的模型选择边界

财报提供总体规模与收入等锚点，客户级风险因素、权重和干预效应包含人工假设。当前标签按加权风险因素经过 sigmoid 转换并加入随机性生成，因此模型比较只能说明在当前合成情景中的表现，不代表对公司真实客户的预测能力。保留规则、逻辑回归、LightGBM 与生存模型的现有对照，不依据一次分数差异直接替换模型。

后续研究应先为锚点区分“披露值、推算值、假设值”，核对流失率统计周期是否与六个月标签窗口一致；用户数量净下降不能直接等同于流失率。本轮未重新核验财报原文，也未修改锚点或原始数据。

选型时应在训练数据内部交叉验证，比较 PR-AUC、固定联系人数下的召回率、概率校准与复杂度，保留独立测试集作最终评价；通过不同随机种子、噪声、风险因素强度和交互情景检查稳定性。不能通过反复调整合成规则来让指定模型获胜，也不能把合成测试分数当作真实业务效果。方法参考：[scikit-learn 交叉验证](https://scikit-learn.org/stable/modules/cross_validation.html)。

干预收益需要单独验证。当前干预历史也是合成数据，流失预测准确不意味着挽留措施在真实业务中有效；多情景实验与真实业务验证属于后续研究，本次测试建设未新增这些实验。
