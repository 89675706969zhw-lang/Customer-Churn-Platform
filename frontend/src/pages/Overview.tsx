import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, ChartNoAxesCombined, FlaskConical, ListFilter, ShieldCheck, Users } from "lucide-react";
import { api, number, percent, type Dashboard } from "../api";
import { Chart, palette } from "../Chart";
import { Button } from "../components/ui/button";
import { useCountUp } from "../hooks";
import { Panel, Status, Kpi } from "../components/shared";

export default function Overview() {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["dashboard"],
    queryFn: ({ signal }) => api<Dashboard>("/dashboard", undefined, signal),
  });
  const totalCustomers = useCountUp(q.data?.total ?? 0);
  if (!q.data) return <Status error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const trendRates = d.trend.map(
    (t) => d.lines.reduce((s, l) => s + t[l.key] * l.total, 0) / d.total,
  );
  const maxRate = Math.max(...trendRates, 1e-6);
  return (
    <>
      <div className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <Activity size={14} /> CUSTOMER RETENTION INTELLIGENCE
          </span>
          <h1>
            洞察流失风险，
            <br />
            <em>让每一次挽留更有价值。</em>
          </h1>
          <p>
            从客户风险识别，到原因诊断与干预决策。
            <br />
            把数据转化为可执行的客户留存行动。
          </p>
          <Button onClick={() => navigate("/customers")}>
            查看风险名单 <ArrowRight />
          </Button>
        </div>
        <div className="hero-insight">
          <div className="insight-top">
            <span className="tiny-dot" /> 当前观测窗口 M1–M{d.metrics.observation_months}{" "}
            <span>模型 {d.version.slice(0, 8)}</span>
          </div>
          <div className="insight-number">
            {number(totalCustomers)}
            <span>
              位客户已完成风险评估 · <b className="text-red">{number(d.high)} 位高风险</b> ·{" "}
              <b className="text-green">{number(d.uplift_stats.recoverable)} 位可挽回</b>
            </span>
          </div>
          <div
            className="signal-bars"
            role="img"
            aria-label="标签窗口逐月流失事件率"
          >
            {d.trend.map((t, i) => (
              <i
                key={t.month}
                title={`M${t.month} 流失事件率 ${(trendRates[i] * 100).toFixed(2)}%`}
                style={{
                  height: `${Math.max(12, Math.round((trendRates[i] / maxRate) * 100))}%`,
                  animationDelay: `${i * 90}ms`,
                }}
              />
            ))}
          </div>
          <div className="signal-labels" aria-hidden="true">
            {d.trend.map((t) => (
              <span key={t.month}>M{t.month}</span>
            ))}
          </div>
          <div className="insight-bottom">
            <ShieldCheck size={17} /> 评分完成 · 平均个体增益 {percent(d.uplift_stats.ate)}{" "}
            <span>{number(d.monthly_rows)} 条月度记录</span>
          </div>
        </div>
      </div>
      <div className="section-line">
        <h2>经营总览</h2>
        <span>
          预测窗口 M{d.metrics.observation_months + 1}–M
          {d.metrics.observation_months + d.metrics.label_months} · 合成数据
        </span>
      </div>
      {d.invalid_event_months > 0 && (
        <div className="data-notice" role="note">
          数据校验：{number(d.invalid_event_months)} 条流失事件的月份超出
          M{d.metrics.observation_months + 1}–M
          {d.metrics.observation_months + d.metrics.label_months}
          或缺失，未计入月度趋势。评分仍沿用原始二元标签，月度趋势与总流失率因此存在差额。
        </div>
      )}
      <div className="kpis">
        <Kpi
          label="客户总数"
          value={number(d.total)}
          foot="覆盖 4 条业务线 · 10 个区域"
          icon={<Users />}
        />
        <Kpi
          label="平均流失风险"
          value={percent(d.average_risk)}
          foot={`未来 ${d.metrics.label_months} 个月 · 校准概率`}
          icon={<Activity />}
          tone="orange"
        />
        <Kpi
          label="高风险客户"
          value={number(d.high)}
          foot="风险 ≥70% · 点击查看名单"
          icon={<ListFilter />}
          tone="red"
          onClick={() => navigate("/customers?band=high")}
        />
        <Kpi
          label="可挽回客户"
          value={number(d.uplift_stats.recoverable)}
          foot={`高风险且干预敏感 · 平均增益 ${percent(d.uplift_stats.ate)}`}
          icon={<ShieldCheck />}
        />
        <Kpi
          label="干预敏感客户"
          value={number(d.uplift_stats.sensitive)}
          foot={`个体增益 ≥4 个百分点 · P90 ${percent(d.uplift_stats.p90)}`}
          icon={<FlaskConical />}
        />
        <Kpi
          label={`${d.metrics.label_months} 个月风险收入`}
          value={`${(d.expected_revenue_at_risk / 1e6).toFixed(2)} M ₽`}
          foot={`风险概率 × 月账单 × ${d.metrics.label_months}`}
          icon={<ChartNoAxesCombined />}
          tone="green"
        />
      </div>
      <div className="grid-wide">
        <Panel
          title="分业务线流失事件趋势"
          subtitle="标签窗口实际合成事件 / 各业务线客户数；非逐月预测值"
        >
          <Chart
            label={`M${d.metrics.observation_months + 1} 至 M${
              d.metrics.observation_months + d.metrics.label_months
            } 分业务线流失事件率`}
            option={{
              tooltip: {
                trigger: "axis",
                valueFormatter: (v) => `${Number(v).toFixed(2)}%`,
              },
              legend: { bottom: 0 },
              grid: { left: 44, right: 20, top: 25, bottom: 55 },
              xAxis: {
                type: "category",
                data: d.trend.map((t) => `M${t.month}`),
                boundaryGap: false,
              },
              yAxis: {
                type: "value",
                axisLabel: { formatter: "{value}%" },
                splitLine: { lineStyle: { color: "#f0edf5" } },
              },
              series: d.lines.map((l, i) => ({
                name: l.name,
                type: "line",
                smooth: true,
                symbolSize: 6,
                lineStyle: { width: 3 },
                itemStyle: { color: palette[i] },
                data: d.trend.map((t) => +(t[l.key] * 100).toFixed(2)),
              })),
            }}
          />
        </Panel>
        <Panel title="风险客户构成" subtitle="点击图形查看对应名单">
          <Chart
            label="高、中、低风险人数分布"
            onClick={(name) =>
              navigate(
                `/customers?band=${d.bands.find((b) => b.name === name)?.key ?? ""}`,
              )
            }
            option={{
              tooltip: { trigger: "item" },
              legend: { bottom: 0, icon: "circle" },
              color: ["#e04c64", "#ed8b23", "#9a73ea"],
              series: [
                {
                  type: "pie",
                  radius: ["49%", "70%"],
                  center: ["50%", "42%"],
                  avoidLabelOverlap: true,
                  itemStyle: {
                    borderColor: "#fff",
                    borderWidth: 4,
                    borderRadius: 7,
                  },
                  label: { show: false },
                  data: d.bands,
                },
              ],
            }}
          />
          <div className="band-links">
            {d.bands.map((b) => (
              <button
                key={b.key}
                onClick={() => navigate(`/customers?band=${b.key}`)}
              >
                {b.name}
                <strong>{number(b.value)}</strong>
              </button>
            ))}
          </div>
        </Panel>
      </div>
      <div className="grid-two">
        <Panel
          title="业务线风险对比"
          subtitle={`${d.metrics.label_months} 个月平均预测概率与合成标签实际发生率`}
        >
          <Chart
            label="业务线预测与实际流失率对比"
            option={{
              tooltip: { trigger: "axis" },
              legend: { bottom: 0 },
              grid: { left: 44, right: 20, top: 20, bottom: 55 },
              xAxis: { type: "category", data: d.lines.map((l) => l.name) },
              yAxis: { type: "value", axisLabel: { formatter: "{value}%" } },
              series: [
                {
                  name: "预测风险",
                  type: "bar",
                  barMaxWidth: 24,
                  itemStyle: { borderRadius: [4, 4, 0, 0] },
                  data: d.lines.map((l) => +(l.predicted * 100).toFixed(2)),
                },
                {
                  name: "实际发生率",
                  type: "bar",
                  barMaxWidth: 24,
                  itemStyle: { color: "#d9c6fa", borderRadius: [4, 4, 0, 0] },
                  data: d.lines.map((l) => +(l.observed * 100).toFixed(2)),
                },
              ],
            }}
          />
        </Panel>
        <Panel
          title="关键风险驱动因素"
          subtitle="全量客户平均 |SHAP| · 校准后对数几率贡献"
        >
          <Chart
            label="模型特征贡献排名"
            option={{
              tooltip: { trigger: "axis" },
              grid: { left: 118, right: 30, top: 12, bottom: 24 },
              xAxis: {
                type: "value",
                splitLine: { lineStyle: { color: "#f0edf5" } },
              },
              yAxis: {
                type: "category",
                inverse: true,
                data: d.importance.map((i) => i.name),
                axisTick: { show: false },
                axisLine: { show: false },
              },
              series: [
                {
                  type: "bar",
                  barWidth: 14,
                  itemStyle: { borderRadius: [0, 5, 5, 0] },
                  data: d.importance.map((i) => +i.value.toFixed(3)),
                },
              ],
            }}
          />
        </Panel>
      </div>
      <div className="grid-two">
        <Panel
          title="四档基线对比"
          subtitle="S4 协议 · B0 规则 / B1 逻辑回归 / B2 LightGBM / B3 离散生存 · 同一独立留出集"
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>基线</th>
                  <th>PR-AUC</th>
                  <th>Lift@10%</th>
                  <th>Recall@10%</th>
                  <th>ROC-AUC</th>
                  <th>ECE</th>
                </tr>
              </thead>
              <tbody>
                {d.baselines.map((b) => (
                  <tr key={b.key}>
                    <td>{b.name}</td>
                    <td>{b.pr_auc.toFixed(4)}</td>
                    <td>{b.lift.toFixed(2)}×</td>
                    <td>{percent(b.recall)}</td>
                    <td>{b.auc.toFixed(4)}</td>
                    <td>{b.ece === undefined ? "—" : b.ece.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="footnote">
            B0–B3 使用同一留出集比较，不预设模型排名。合成标签以加权 logit
            机制生成；分数仅描述当前合成情景，不代表真实客户预测效果。
          </p>
        </Panel>
        <Panel
          title="消融实验"
          subtitle="逐族移除特征后重训 LightGBM · PR-AUC 下降越多，该特征族越关键"
        >
          <Chart
            label="各特征族移除后的 PR-AUC 变化"
            option={{
              tooltip: {
                trigger: "axis",
                valueFormatter: (v) => Number(v).toFixed(4),
              },
              grid: { left: 96, right: 30, top: 12, bottom: 24 },
              xAxis: {
                type: "value",
                splitLine: { lineStyle: { color: "#f0edf5" } },
              },
              yAxis: {
                type: "category",
                inverse: true,
                data: d.ablation.map((a) => a.group),
                axisTick: { show: false },
                axisLine: { show: false },
              },
              series: [
                {
                  type: "bar",
                  barWidth: 14,
                  itemStyle: { borderRadius: [0, 5, 5, 0], color: "#e04c64" },
                  data: d.ablation.map((a) => +a.delta_pr_auc.toFixed(4)),
                },
              ],
            }}
          />
        </Panel>
      </div>
      <section className="model-strip">
        <div>
          <ShieldCheck />
          <strong>模型验证</strong>
          <span>独立留出 {number(d.metrics.holdout_size)} 位客户</span>
        </div>
        {[
          ["ROC-AUC", d.metrics.auc.toFixed(4)],
          ["PR-AUC", d.metrics.pr_auc.toFixed(4)],
          ["Lift@10%", `${d.metrics.lift.toFixed(2)}×`],
          ["ECE", d.metrics.ece.toFixed(4)],
        ].map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </section>
      <p className="footnote">
        演示评分覆盖训练、校准与留出样本；上方验证指标仅使用独立留出集。合成数据不代表真实客户表现。
      </p>
    </>
  );
}
