import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronLeft, Search } from "lucide-react";
import { api, emptyFilters, money, percent, type CustomerPage, type Detail, type Meta, type Selection } from "../api";
import { Chart } from "../Chart";
import { Button } from "../components/ui/button";
import { Panel, Status, Badge, PageHead } from "../components/shared";

export default function Diagnosis({
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
                电话挽留样本外增益估计：
                <b className={d.uplift > 0 ? "text-green" : ""}>{percent(d.uplift)}</b>
                （流失概率变化，负值表示可能增加风险）· 期望净收益
                <b className={d.gain > 0 ? "text-green" : ""}>{money(d.gain)}</b>
              </span>
              <p className="footnote">干预模型概率：未干预 {percent(d.p0)} → 基准电话干预 {percent(d.p1)}。来自合成实验，不等同于主模型风险评分或实测挽回效果。</p>
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
