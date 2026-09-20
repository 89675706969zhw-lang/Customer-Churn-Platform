import { useEffect, useState, type ReactNode } from "react";
import {
  NavLink,
  Route,
  Routes,
  Link,
  useNavigate,
  useParams,
  useSearchParams,
  useLocation,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  Activity,
  ArrowRight,
  ArrowUpDown,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  Download,
  FlaskConical,
  LayoutDashboard,
  ListFilter,
  Phone,
  Search,
  ShieldCheck,
  Smartphone,
  Users,
  Mail,
  BriefcaseBusiness,
  RotateCcw,
} from "lucide-react";
import {
  api,
  emptyFilters,
  queryString,
  number,
  money,
  percent,
  type Customer,
  type CustomerPage,
  type Dashboard,
  type Detail,
  type Filters,
  type Meta,
  type Selection,
  type SimParams,
  type SimResult,
} from "./api";
import { Chart, palette } from "./Chart";
import { Button } from "./components/ui/button";

function useDebounce<T>(value: T, delay = 300) {
  const [result, setResult] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setResult(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return result;
}
function useCountUp(target: number, duration = 1000) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}
function Panel({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
function Status({
  error,
  retry,
}: {
  error?: Error | null;
  retry?: () => void;
}) {
  return (
    <div className="status" role={error ? "alert" : "status"}>
      {error ? (
        <>
          <p>{error.message}</p>
          <Button variant="outline" onClick={retry}>
            重新加载
          </Button>
        </>
      ) : (
        <>
          <span className="spinner" />
          <p>正在加载数据…</p>
        </>
      )}
    </div>
  );
}
function Kpi({
  label,
  value,
  foot,
  tone = "purple",
  icon,
  onClick,
}: {
  label: string;
  value: string;
  foot: string;
  tone?: string;
  icon: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="kpi-head">
        <span>{label}</span>
        <span className={`icon-box ${tone}`}>{icon}</span>
      </div>
      <div className={`kpi-value ${tone}`}>{value}</div>
      <div className="kpi-foot">
        {foot}
        {onClick && <ArrowRight size={14} />}
      </div>
    </>
  );
  return onClick ? (
    <button className="kpi clickable" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="kpi">{content}</div>
  );
}
function Badge({ band }: { band: string }) {
  return (
    <span className={`badge ${band}`}>
      {
        (
          { high: "高风险", mid: "中风险", low: "低风险" } as Record<
            string,
            string
          >
        )[band]
      }
    </span>
  );
}
function PageHead({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

function Overview() {
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
            B0–B3 呈可解释递进；线性基线略优于树模型属预期——合成标签由线性
            logit 机制生成，线性模型贴近数据生成过程。
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

function RiskList({
  meta,
  setSelection,
}: {
  meta: Meta;
  setSelection: (s: Selection) => void;
}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters: Filters = {
    line: params.get("line") || "",
    band: params.get("band") || "",
    region: params.get("region") || "",
    search: params.get("search") || "",
  };
  const page = Math.max(1, Number(params.get("page")) || 1);
  const sort = params.get("sort") || "score",
    direction = params.get("direction") || "desc";
  const search = useDebounce(filters.search);
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState("");
  const q = useQuery({
    queryKey: [
      "customers",
      filters.line,
      filters.band,
      filters.region,
      search,
      page,
      sort,
      direction,
    ],
    queryFn: ({ signal }) =>
      api<CustomerPage>(
        `/customers?${queryString({ ...filters, search, page, sort, direction })}`,
        undefined,
        signal,
      ),
  });
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };
  const columns: ColumnDef<Customer>[] = [
    {
      accessorKey: "customer_id",
      header: "客户编号",
      cell: (c) => (
        <Link
          className="customer-link"
          to={`/customers/${c.row.original.customer_id}`}
        >
          {c.getValue<string>()}
          <ArrowRight size={13} />
        </Link>
      ),
    },
    {
      accessorKey: "business_line",
      header: "业务线",
      cell: (c) => (
        <span className="line-label">{meta.lines[c.getValue<string>()]}</span>
      ),
    },
    {
      accessorKey: "region",
      header: "区域",
      cell: (c) => meta.regions[c.getValue<string>()],
    },
    { accessorKey: "tenure_months", header: "在网（月）" },
    {
      accessorKey: "arpu",
      header: "月均账单",
      cell: (c) => money(c.getValue<number>()),
    },
    {
      accessorKey: "score",
      header: "流失风险",
      cell: (c) => (
        <div className="risk-cell">
          <div className={`risk-track ${c.row.original.band}`}>
            <i style={{ width: percent(c.getValue<number>()) }} />
          </div>
          <strong>{percent(c.getValue<number>())}</strong>
          <Badge band={c.row.original.band} />
        </div>
      ),
    },
    {
      accessorKey: "gain",
      header: "期望净收益",
      cell: (c) => (
        <span
          className={c.getValue<number>() > 0 ? "text-green" : "text-muted"}
        >
          {money(c.getValue<number>())}
        </span>
      ),
    },
    { accessorKey: "reason", header: "主要风险因素" },
  ];
  const table = useReactTable({
    data: q.data?.items || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
  });
  async function exportCsv() {
    setExporting(true);
    setExportError("");
    try {
      const r = await fetch(`/api/customers/export?${queryString(filters)}`);
      if (!r.ok) throw new Error("导出失败，请重试");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "churn-risk-list.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <PageHead
        eyebrow="CUSTOMER RISK LIST"
        title="客户风险名单"
        subtitle="定位值得关注的客户，按风险与预期价值安排下一步行动。"
        action={
          <Button
            disabled={!q.data?.total || q.isFetching}
            onClick={() => {
              setSelection({
                filters,
                customer_ids: null,
                name: `筛选名单 · ${number(q.data!.total)} 人`,
              });
              navigate("/simulation");
            }}
          >
            纳入干预仿真 <ArrowRight />
          </Button>
        }
      />
      <section className="panel list-panel">
        <div className="filters">
          <label>
            业务线
            <select
              value={filters.line}
              onChange={(e) => update("line", e.target.value)}
            >
              <option value="">全部业务线</option>
              {Object.entries(meta.lines).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            风险等级
            <select
              value={filters.band}
              onChange={(e) => update("band", e.target.value)}
            >
              <option value="">全部风险</option>
              <option value="high">高风险 ≥70%</option>
              <option value="mid">中风险 40–70%</option>
              <option value="low">低风险 &lt;40%</option>
            </select>
          </label>
          <label>
            所属区域
            <select
              value={filters.region}
              onChange={(e) => update("region", e.target.value)}
            >
              <option value="">全部区域</option>
              {Object.entries(meta.regions).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="search-label">
            客户编号
            <div className="search-input">
              <Search size={16} />
              <input
                value={filters.search}
                placeholder="搜索 RT-000001…"
                onChange={(e) => update("search", e.target.value)}
              />
            </div>
          </label>
          <Button variant="ghost" onClick={() => setParams({})}>
            <RotateCcw />
            重置
          </Button>
          <Button
            variant="outline"
            disabled={exporting || !q.data?.total}
            onClick={exportCsv}
          >
            <Download />
            {exporting ? "导出中…" : "导出 CSV"}
          </Button>
        </div>
        <div className="list-caption">
          <span>
            <span className="tiny-dot" />{" "}
            {q.data ? `共 ${number(q.data.total)} 位客户` : "加载中"}
          </span>
          <span>
            期望净收益：个体增益 × ARPU × {meta.clv_months} 个月 − 电话挽留基准成本
          </span>
        </div>
        {exportError && (
          <p role="alert" className="error-text">
            {exportError}
          </p>
        )}
        {q.isPending || q.isError ? (
          <Status error={q.error} retry={() => q.refetch()} />
        ) : q.data.total === 0 ? (
          <div className="empty">
            <Search />
            <h2>没有匹配的客户</h2>
            <p>试试调整业务线、风险等级或客户编号。</p>
            <Button variant="outline" onClick={() => setParams({})}>
              清除筛选
            </Button>
          </div>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  {table.getHeaderGroups().map((g) => (
                    <tr key={g.id}>
                      {g.headers.map((h) => {
                        const sortable = [
                          "customer_id",
                          "tenure_months",
                          "arpu",
                          "score",
                          "gain",
                        ].includes(h.id);
                        return (
                          <th
                            key={h.id}
                            aria-sort={
                              sort === h.id
                                ? direction === "asc"
                                  ? "ascending"
                                  : "descending"
                                : undefined
                            }
                          >
                            {sortable ? (
                              <button
                                onClick={() => {
                                  const next = new URLSearchParams(params);
                                  next.set("sort", h.id);
                                  next.set(
                                    "direction",
                                    sort === h.id && direction === "desc"
                                      ? "asc"
                                      : "desc",
                                  );
                                  next.delete("page");
                                  setParams(next);
                                }}
                              >
                                {flexRender(
                                  h.column.columnDef.header,
                                  h.getContext(),
                                )}
                                <ArrowUpDown size={12} />
                              </button>
                            ) : (
                              flexRender(
                                h.column.columnDef.header,
                                h.getContext(),
                              )
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id}>
                      {row.getVisibleCells().map((c) => (
                        <td key={c.id}>
                          {flexRender(c.column.columnDef.cell, c.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                每页 20 条 · 第 {page} /{" "}
                {Math.max(1, Math.ceil(q.data.total / 20))} 页
              </span>
              <div>
                <Button
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => update("page", String(page - 1))}
                >
                  <ChevronLeft />
                  上一页
                </Button>
                <Button
                  variant="outline"
                  disabled={page * 20 >= q.data.total}
                  onClick={() => update("page", String(page + 1))}
                >
                  下一页
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}

function Diagnosis({
  meta,
  selection,
  setSelection,
}: {
  meta: Meta;
  selection: Selection;
  setSelection: (s: Selection) => void;
}) {
  const { cid } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useState(cid || "");
  useEffect(() => setSearch(cid || ""), [cid]);
  const first = useQuery({
    queryKey: ["first-customer"],
    queryFn: ({ signal }) =>
      api<CustomerPage>("/customers?page_size=1", undefined, signal),
    enabled: !cid,
  });
  useEffect(() => {
    if (!cid && first.data?.items[0])
      navigate(`/customers/${first.data.items[0].customer_id}`, {
        replace: true,
      });
  }, [cid, first.data, navigate]);
  const q = useQuery({
    queryKey: ["customer", cid],
    queryFn: ({ signal }) =>
      api<Detail>(`/customers/${encodeURIComponent(cid!)}`, undefined, signal),
    enabled: !!cid,
  });
  const d = q.data;
  return (
    <>
      <PageHead
        eyebrow="CUSTOMER DIAGNOSTICS"
        title="单客户诊断"
        subtitle="理解每一次风险评分背后的因素，制定有依据的沟通方案。"
        action={
          <Button asChild variant="outline">
            <Link to="/customers">
              <ChevronLeft />
              返回名单
            </Link>
          </Button>
        }
      />
      <form
        className="lookup"
        onSubmit={(e) => {
          e.preventDefault();
          if (search.trim())
            navigate(`/customers/${encodeURIComponent(search.trim())}`);
        }}
      >
        <label htmlFor="customer-lookup">客户编号</label>
        <input
          id="customer-lookup"
          placeholder="RT-000001"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button type="submit" variant="outline">
          <Search />
          查询客户
        </Button>
      </form>
      {!d ? (
        <Status
          error={q.error || first.error}
          retry={() => (cid ? q.refetch() : first.refetch())}
        />
      ) : (
        <>
          <div className="customer-head">
            <div className="score-card">
              <span>未来 {meta.label_months} 个月流失概率</span>
              <strong>{percent(d.score)}</strong>
              <Badge band={d.band} />
              <p>{d.customer_id}</p>
            </div>
            <section className="panel customer-info">
              <div className="section-line">
                <h2>客户画像</h2>
                <span className="line-label">
                  {
                    (
                      {
                        train: "训练样本",
                        calibration: "校准样本",
                        holdout: "独立留出样本",
                      } as Record<string, string>
                    )[d.evaluation_split]
                  }
                </span>
              </div>
              <dl>
                {[
                  ["业务线", meta.lines[d.business_line]],
                  ["所属区域", meta.regions[d.region]],
                  ["在网时长", `${d.tenure_months} 个月`],
                  ["产品持有", `${d.n_products} 项`],
                  [
                    "合约类型",
                    (
                      {
                        monthly: "按月付费",
                        annual: "年度合约",
                        two_year: "两年合约",
                      } as Record<string, string>
                    )[d.contract_type],
                  ],
                  ["距合约到期", `${d.days_to_contract_end} 天`],
                  ["月均账单", money(d.arpu)],
                  ["近六月工单", `${d.tickets} 次`],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
          <div className="grid-two">
            <Panel
              title="风险归因 · SHAP"
              subtitle="红色提高风险，绿色降低风险；数值为对数几率贡献"
            >
              <Chart
                label="单客户 SHAP 特征贡献"
                height={350}
                option={{
                  tooltip: { trigger: "axis" },
                  grid: { left: 123, right: 44, top: 12, bottom: 24 },
                  xAxis: { type: "value" },
                  yAxis: {
                    type: "category",
                    inverse: true,
                    data: d.contributions.map((c) => c.name),
                    axisTick: { show: false },
                    axisLine: { show: false },
                  },
                  series: [
                    {
                      type: "bar",
                      barWidth: 15,
                      data: d.contributions.map((c) => ({
                        value: +c.value.toFixed(3),
                        itemStyle: {
                          color: c.value > 0 ? "#e04c64" : "#059669",
                          borderRadius: 3,
                        },
                      })),
                    },
                  ],
                }}
              />
              <div className="explanation-note">
                基准 {d.base_value.toFixed(3)} + 全部特征贡献 → 评分{" "}
                {percent(d.score)}
              </div>
            </Panel>
            <Panel
              title="使用量与账单变化"
              subtitle={`只展示预测时点前 M1–M${meta.obs_months} 的真实合成记录`}
            >
              <Chart
                label="客户观测期内用量与账单曲线"
                height={350}
                option={{
                  tooltip: { trigger: "axis" },
                  legend: { bottom: 0 },
                  grid: { left: 48, right: 55, top: 30, bottom: 50 },
                  xAxis: {
                    type: "category",
                    boundaryGap: false,
                    data: d.history.map((h) => `M${h.month}`),
                  },
                  yAxis: [
                    { type: "value", name: "GB" },
                    { type: "value", name: "₽", splitLine: { show: false } },
                  ],
                  series: [
                    {
                      name: "使用量",
                      type: "line",
                      smooth: true,
                      data: d.history.map((h) => h.usage_gb),
                      symbolSize: 5,
                    },
                    {
                      name: "月账单",
                      type: "line",
                      yAxisIndex: 1,
                      itemStyle: { color: "#ed8b23" },
                      lineStyle: { type: "dashed" },
                      data: d.history.map((h) => h.bill_amount),
                      symbolSize: 5,
                    },
                  ],
                }}
              />
            </Panel>
          </div>
          <section className="action-panel">
            <div>
              <span className="eyebrow">NEXT BEST ACTION</span>
              <h2>重点关注：{d.reason}</h2>
              <p>{d.suggestion}</p>
              <span className="text-muted">
                电话挽留个体增益：
                <b className={d.uplift > 0 ? "text-green" : ""}>{percent(d.uplift)}</b>
                （流失概率下降）· 期望净收益
                <b className={d.gain > 0 ? "text-green" : ""}>{money(d.gain)}</b>
              </span>
            </div>
            <Button
              onClick={() => {
                const ids = [
                  ...new Set([
                    ...(selection.customer_ids || []),
                    d.customer_id,
                  ]),
                ];
                setSelection({
                  filters: emptyFilters,
                  customer_ids: ids,
                  name: `手选客户 · ${ids.length} 人`,
                });
                navigate("/simulation");
              }}
            >
              加入干预仿真 <ArrowRight />
            </Button>
          </section>
        </>
      )}
    </>
  );
}

function Simulation({
  meta,
  selection,
  setSelection,
}: {
  meta: Meta;
  selection: Selection;
  setSelection: (s: Selection) => void;
}) {
  const initialChannel = meta.channels.find((ch) => ch.id === "call") ?? meta.channels[0];
  const [channel, setChannel] = useState(initialChannel.id);
  const [cost, setCost] = useState(initialChannel.cost),
    [success, setSuccess] = useState(initialChannel.success),
    [maxK, setMaxK] = useState(3000),
    [months, setMonths] = useState(meta.clv_months),
    [budgetText, setBudgetText] = useState("");
  const budget = budgetText === "" ? null : Number(budgetText);
  const valid =
    budget === null ||
    (Number.isFinite(budget) && budget >= 0 && budget <= 1e10);
  const input: SimParams = {
    cost,
    success,
    max_k: maxK,
    clv_months: months,
    budget: valid ? budget : null,
    filters: selection.filters,
    customer_ids: selection.customer_ids,
  };
  const stable = useDebounce(JSON.stringify(input));
  const pending = stable !== JSON.stringify(input);
  const q = useQuery({
    queryKey: ["simulation", stable],
    queryFn: ({ signal }) =>
      api<SimResult>("/simulate", JSON.parse(stable), signal),
    enabled: valid,
  });
  const r = !pending && valid ? q.data : undefined;
  const icons = [Phone, Mail, Smartphone, BriefcaseBusiness];
  return (
    <>
      <PageHead
        eyebrow="INTERVENTION SIMULATOR"
        title="让留存预算，花在更值得的地方。"
        subtitle="选择渠道、调整成本与成功率，比较不同干预规模下的预期收益。"
      />
      <div className="channels" role="group" aria-label="选择干预渠道">
        {meta.channels.map((ch, i) => {
          const Icon = icons[i];
          return (
            <button
              key={ch.id}
              aria-pressed={channel === ch.id}
              className={`channel ${channel === ch.id ? "selected" : ""}`}
              onClick={() => {
                setChannel(ch.id);
                setCost(ch.cost);
                setSuccess(ch.success);
              }}
            >
              <div className="channel-top">
                <Icon size={21} />
                <span className="radio-dot" />
              </div>
              <strong>{ch.name}</strong>
              <p>{ch.description}</p>
              <div>
                <span>{money(ch.cost)} /人</span>
                <span>效果系数 {ch.success.toFixed(2)}×</span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="simulation-grid">
        <aside className="panel controls">
          <h2>参数微调</h2>
          <p className="text-muted">按当前业务假设估算</p>
          <div className="selection-info">
            <Users size={17} />
            <div>
              <b>{selection.name}</b>
              <span>
                {r
                  ? `${number(r.candidate_count)} 位候选客户`
                  : "正在计算候选名单"}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            onClick={() =>
              setSelection({
                filters: emptyFilters,
                customer_ids: null,
                name: "全部客户",
              })
            }
          >
            <RotateCcw />
            恢复全部客户
          </Button>
          {[
            {
              id: "cost",
              label: "单次干预成本",
              value: cost,
              min: 10,
              max: 6000,
              step: 10,
              display: money(cost),
              set: setCost,
            },
            {
              id: "success",
              label: "渠道效果系数",
              value: success,
              min: 0,
              max: 2,
              step: 0.05,
              display: `${success.toFixed(2)}×`,
              set: setSuccess,
            },
            {
              id: "maxk",
              label: "干预人数上限",
              value: maxK,
              min: 0,
              max: 30000,
              step: 10,
              display: `${number(maxK)} 人`,
              set: setMaxK,
            },
            {
              id: "months",
              label: "收入估算月数",
              value: months,
              min: 1,
              max: 36,
              step: 1,
              display: `${months} 个月`,
              set: setMonths,
            },
          ].map((c) => (
            <div className="slider-field" key={c.id}>
              <label htmlFor={c.id}>
                {c.label}
                <b>{c.display}</b>
              </label>
              <input
                type="range"
                id={c.id}
                min={c.min}
                max={c.max}
                step={c.step}
                value={c.value}
                onChange={(e) => c.set(Number(e.target.value))}
              />
            </div>
          ))}
          <label className="budget-label" htmlFor="budget">
            预算上限（₽，选填）
            <input
              id="budget"
              type="number"
              min="0"
              max="10000000000"
              placeholder="不限制预算"
              value={budgetText}
              onChange={(e) => setBudgetText(e.target.value)}
            />
          </label>
          {!valid && (
            <p className="error-text" role="alert">
              预算须为 0 至 100 亿之间的数值。
            </p>
          )}
          <p className="assumption">
            个体增益来自 T-learner 对随机化干预历史的估计；渠道效果系数是相对电话挽留的情景假设。
            此处估算的是期望挽回收入减干预成本，不等同于实测利润。
          </p>
        </aside>
        <div className="sim-main">
          {!valid ? (
            <div className="status" role="alert">请修正预算上限后继续计算。</div>
          ) : !r ? (
            <Status error={q.error} retry={() => q.refetch()} />
          ) : (
            <>
              <div className="sim-kpis">
                <Kpi
                  label="建议干预人数"
                  value={number(r.best_k)}
                  foot={`候选 ${number(r.candidate_count)} 人中择优`}
                  icon={<Users />}
                />
                <Kpi
                  label="预期净挽回收入"
                  value={money(r.net)}
                  foot={`预计投入 ${money(r.cost)}`}
                  tone="green"
                  icon={<ChartNoAxesCombined />}
                />
                <Kpi
                  label="预期收入 ROI"
                  value={r.roi === null ? "—" : percent(r.roi)}
                  foot="净挽回收入 / 干预成本"
                  tone="orange"
                  icon={<Activity />}
                />
                <Kpi
                  label="候选平均个体增益"
                  value={percent(r.mean_uplift)}
                  foot="T-learner · 干预后流失概率下降"
                  icon={<ShieldCheck />}
                />
              </div>
              <Panel
                title="收益与干预规模"
                subtitle={`同规模随机干预预计净收益 ${money(r.random_net)}；不干预基线为 0`}
              >
                <Chart
                  label="不同干预规模的毛挽回、净收益与成本"
                  option={{
                    tooltip: { trigger: "axis" },
                    legend: { bottom: 0 },
                    grid: { left: 75, right: 20, top: 25, bottom: 60 },
                    xAxis: {
                      type: "category",
                      data: r.curve.map((p) => p.k),
                      name: "人数",
                      nameLocation: "middle",
                      nameGap: 28,
                    },
                    yAxis: {
                      type: "value",
                      axisLabel: {
                        formatter: (v: number) => `${(v / 1000).toFixed(0)}k ₽`,
                      },
                    },
                    series: [
                      {
                        name: "预期净挽回",
                        type: "line",
                        showSymbol: false,
                        areaStyle: { opacity: 0.06 },
                        lineStyle: { width: 3 },
                        data: r.curve.map((p) => Math.round(p.net)),
                      },
                      {
                        name: "预期毛挽回",
                        type: "line",
                        showSymbol: false,
                        lineStyle: { type: "dashed" },
                        data: r.curve.map((p) => Math.round(p.gross)),
                      },
                      {
                        name: "累计成本",
                        type: "line",
                        showSymbol: false,
                        lineStyle: { type: "dotted" },
                        data: r.curve.map((p) => Math.round(p.cost)),
                      },
                    ],
                  }}
                />
              </Panel>
              <Panel
                title="候选名单分组"
                subtitle="按流失概率 × 个体敏感度（T-learner 估计的干预增益）二维划分"
              >
                <div className="groups">
                  {r.groups.map((g, i) => (
                    <div className={`group group-${i}`} key={g.name}>
                      <span>{g.name}</span>
                      <strong>{number(g.value)}</strong>
                      <small>位客户</small>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel
                title="建议优先联系"
                subtitle={
                  r.best_k
                    ? `按期望净收益排序，显示前 ${Math.min(30, r.best_k)} 位`
                    : "当前参数下没有正收益方案，建议调整成本或渠道"
                }
              >
                {r.customers.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>客户编号</th>
                          <th>业务线</th>
                          <th>风险概率</th>
                          <th>期望净收益</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {r.customers.map((c) => (
                          <tr key={c.customer_id}>
                            <td>
                              <Link
                                className="customer-link"
                                to={`/customers/${c.customer_id}`}
                              >
                                {c.customer_id}
                              </Link>
                            </td>
                            <td>{meta.lines[c.business_line]}</td>
                            <td>{percent(c.score)}</td>
                            <td className="text-green">
                              {money(c.expected_net)}
                            </td>
                            <td>
                              <Link
                                className="customer-link"
                                to={`/customers/${c.customer_id}`}
                              >
                                查看诊断
                                <ArrowRight size={13} />
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="empty-small">无需按当前参数执行干预。</p>
                )}
              </Panel>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function initialSelection(): Selection {
  try {
    const stored = JSON.parse(
      sessionStorage.getItem("churn-selection") || "null",
    );
    if (
      stored?.filters &&
      typeof stored.name === "string" &&
      (stored.customer_ids === null || Array.isArray(stored.customer_ids))
    )
      return stored;
  } catch {
    /* Ignore expired local state. */
  }
  return { filters: emptyFilters, customer_ids: null, name: "全部客户" };
}
export default function App() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  const [selection, updateSelection] = useState<Selection>(initialSelection);
  function setSelection(value: Selection) {
    updateSelection(value);
    try {
      sessionStorage.setItem("churn-selection", JSON.stringify(value));
    } catch {
      /* Storage is optional. */
    }
  }
  const meta = useQuery({
    queryKey: ["meta"],
    queryFn: ({ signal }) => api<Meta>("/meta", undefined, signal),
  });
  const links = [
    { to: "/", name: "经营总览", icon: LayoutDashboard },
    { to: "/customers", name: "风险名单", icon: ListFilter },
    { to: pathname.startsWith("/customers/") ? pathname : "/diagnosis", name: "单客户诊断", icon: Users },
    { to: "/simulation", name: "干预仿真", icon: FlaskConical },
  ];
  return (
    <>
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        跳转到主要内容
      </a>
      <header className="topbar">
        <Link className="brand" to="/">
          <span className="brand-mark">
            <Activity size={26} />
          </span>
          <span>
            <b>Ростелеком</b>
            <small>客户流失预警平台</small>
          </span>
        </Link>
        <nav aria-label="主导航">
          {links.map((l) => (
            <NavLink
              to={l.to}
              end={l.to === "/" || l.to === "/customers"}
              key={l.to}
            >
              <l.icon size={16} />
              {l.name}
            </NavLink>
          ))}
        </nav>
        <span className="environment">
          <span className="tiny-dot" />
          合成数据演示
        </span>
      </header>
      <main id="main" tabIndex={-1}>
        {meta.data ? (
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route
              path="/customers"
              element={
                <RiskList meta={meta.data} setSelection={setSelection} />
              }
            />
            <Route
              path="/diagnosis"
              element={
                <Diagnosis
                  meta={meta.data}
                  selection={selection}
                  setSelection={setSelection}
                />
              }
            />
            <Route
              path="/customers/:cid"
              element={
                <Diagnosis
                  meta={meta.data}
                  selection={selection}
                  setSelection={setSelection}
                />
              }
            />
            <Route
              path="/simulation"
              element={
                <Simulation
                  meta={meta.data}
                  selection={selection}
                  setSelection={setSelection}
                />
              }
            />
            <Route
              path="*"
              element={
                <div className="empty">
                  <h1>页面不存在</h1>
                  <Button asChild>
                    <Link to="/">返回总览</Link>
                  </Button>
                </div>
              }
            />
          </Routes>
        ) : (
          <Status error={meta.error} retry={() => meta.refetch()} />
        )}
      </main>
      <footer className="footer">
        <span>
          Ростелеком <span className="footer-separator">/</span>{" "}
          客户留存决策支持
        </span>
        <span>30,000 客户 · 24 个月 · 合成数据</span>
      </footer>
    </>
  );
}
