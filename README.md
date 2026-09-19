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

### 一体化启动（推荐）

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

### Docker Compose

```powershell
docker compose up --build
```

服务启动后访问 `http://127.0.0.1:8000`。

## 测试与构建

```powershell
python -m pytest -q
cd frontend
npm run build
```

## 项目结构

```text
backend/                 FastAPI 接口与模型查询引擎
frontend/                React 前端
data/raw/                合成客户、月度行为、流失与干预历史数据
tests/                   后端与模型行为测试
generate_synthetic_data.py  合成数据生成脚本
compose.yaml             Docker Compose 配置
start.ps1                Windows 一体化启动脚本
```

## 数据与模型说明

- 数据集包含 30,000 名合成客户及 24 个月的行为记录。
- 前 18 个月为特征观测期，后 6 个月为流失标签期。
- 模型缓存默认保存在本地 `.runtime/`，它可自动再生成，不应提交到版本库。
- 客户导出、截图、前端构建产物和测试报告同样属于运行产物，已通过 `.gitignore` 排除。
