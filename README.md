# 客户流失预警平台

面向电信客户留存场景的全栈演示平台，提供风险评分、客户筛选、单客诊断、干预仿真和 CSV 导出。

> 项目使用合成数据，仅用于产品、建模与工程演示，不能将结果直接用于真实客户决策。

## 核心功能

- 经营总览：客户规模、风险分层、趋势、模型指标和特征影响。
- 风险名单：按业务线、风险等级、区域和关键词筛选、排序与导出。
- 客户诊断：风险概率、SHAP 贡献、历史用量和账单变化。
- 干预仿真：按渠道、成本、效果系数、人数和预算估算预期收益。
- 模型评估：规则、逻辑回归、LightGBM、生存模型和特征消融对比。

## 技术栈

- 后端：Python 3.13、FastAPI、Pandas、DuckDB、scikit-learn、LightGBM
- 前端：Node.js 24、React、TypeScript、Vite、TanStack、ECharts
- 部署与检查：Docker Compose、Pytest、Vitest、Playwright、GitHub Actions

## 推荐启动：Docker Compose

先启动 Docker Desktop，再在项目根目录执行：

```powershell
docker compose up --build -d
```

首次启动会构建前后端并训练或加载模型。容器健康后访问：

```text
http://127.0.0.1:8000
```

检查状态和日志：

```powershell
docker compose ps
docker compose logs -f retention
```

停止服务：

```powershell
docker compose down
```

服务只绑定本机 `127.0.0.1:8000`。`data/raw` 以只读方式挂载，模型缓存保存在 Docker volume 中。

## 本地开发

一体化启动：

```powershell
.\start.ps1
```

前后端分开启动：

```powershell
python -m pip install -r backend\requirements.txt
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

在另一个终端执行：

```powershell
cd frontend
npm ci
npm run dev
```

前端开发地址为 `http://127.0.0.1:5173`，`/api` 请求代理到后端。

## 测试

后端与模型测试：

```powershell
python -m pytest -q
```

前端类型检查、组件测试和构建：

```powershell
cd frontend
npm ci
npm run typecheck
npm test
npm run build
```

端到端测试会在独立端口 `18000` 启动服务：

```powershell
npx playwright install chromium
npm run test:e2e
```

每次 push 和 pull request 都会运行同样的 GitHub Actions 检查。缓存、构建结果、截图、测试报告和客户导出文件均不提交。

## 项目结构

```text
backend/                    API、风险模型与干预模型
frontend/                   React 前端、组件测试与端到端测试
data/raw/                   合成客户和行为数据
tests/                      后端与模型测试
.github/workflows/          CI 配置
generate_synthetic_data.py  合成数据生成脚本
compose.yaml                Docker Compose 配置
start.ps1                   Windows 一体化启动脚本
```

## 数据与模型边界

- 数据包含 30,000 名合成客户和 24 个月记录；前 18 个月用于特征，后 6 个月用于流失标签。
- 客户级风险因素、权重和干预效果含人工假设。模型指标只描述当前合成情景，不代表真实客户表现。
- 平台沿用 B2 LightGBM 作为当前演示模型，承接风险评分、SHAP 解释和消融流程，并非本次指标最优模型。
- 当前单次合成数据留出集上，B1 逻辑回归和 B3 生存模型的主要排序指标略高。是否换模型，应通过训练集交叉验证和多种合成情景比较决定。
- 生成器保留现有人工参数和原始数据，不通过调整噪声追求目标 AUC，也不根据一次结果指定赢家。
- 干预模型采用五折交叉拟合和 25% 独立留出集。其收益仍来自合成随机化实验，不代表真实挽留效果。
- 仿真使用同一干预模型的未干预概率和干预概率；渠道调整后的概率限制在 `0–1`，负增益保留，最优方案可以是不联系任何人。
- 流失风险评分与干预增益是两个不同问题：前者估计谁可能流失，后者估计干预可能带来的概率变化。

模型缓存位于 `.runtime/`，可自动重建；原始数据、运行缓存及测试产物应保持分离。
