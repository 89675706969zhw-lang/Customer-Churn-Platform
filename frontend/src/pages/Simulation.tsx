import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, ChartNoAxesCombined, Phone, ShieldCheck, Smartphone, Users, Mail, BriefcaseBusiness, RotateCcw } from "lucide-react";
import { api, emptyFilters, number, money, percent, type Meta, type Selection, type SimParams, type SimResult } from "../api";
import { Chart } from "../Chart";
import { Button } from "../components/ui/button";
import { useDebounce } from "../hooks";
import { Panel, Status, Kpi, PageHead } from "../components/shared";

export default function Simulation({
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
        subtitle="选择渠道、调整成本与效果系数，比较合成情景下的预期收益。"
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
            个体增益来自 T-learner 对合成随机化干预历史的样本外估计；渠道效果系数是相对电话挽留的情景假设。
            干预后概率 = 将「未干预概率 − 效果系数 × 基准增益」限制在 0～1 内；
            有效增益 = 未干预概率 − 干预后概率，可能为负。
            概率来自干预模型，与名单中的主模型风险评分不同。挽回收入按有效增益 × 月收入 × 月数估计，减去干预成本后不等同于实测利润。
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
                  label="候选平均有效增益"
                  value={percent(r.mean_rescue)}
                  foot={`已应用渠道系数和概率约束 · 基准 ${percent(r.mean_uplift)}`}
                  icon={<ShieldCheck />}
                />
              </div>
              <Panel title="干预模型 · 样本外验证" subtitle="五折交叉拟合 + 25% 独立留出集；以下指标仅在留出集计算">
                <p className="footnote">
                  开发集 {number(r.intervention_validation.development_size)} 人 · 独立留出集 {number(r.intervention_validation.holdout_size)} 人。
                  留出集 Qini（IPW）{r.intervention_validation.qini_ipw.toFixed(4)}；
                  排名前 10% 的平均避免流失效应估计 {percent(r.intervention_validation.top_decile_effect_ipw)}。
                </p>
                <div className="table-scroll">
                  <table>
                    <caption>留出集分组概率评价</caption>
                    <thead><tr><th>分组</th><th>人数</th><th>实际流失率</th><th>预测均值</th><th>AUC</th><th>Brier</th></tr></thead>
                    <tbody>{r.intervention_validation.arms.map((arm) => (
                      <tr key={arm.arm}><td>{arm.arm ? "干预组" : "对照组"}</td><td>{number(arm.size)}</td><td>{percent(arm.observed_rate)}</td><td>{percent(arm.predicted_rate)}</td><td>{arm.auc.toFixed(3)}</td><td>{arm.brier.toFixed(4)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
                <p className="footnote">
                  Qini 衡量按增益排序相对随机联系的收益曲线面积，按人数归一化；IPW 使用合成实验预设的 30% 干预分配概率。
                  这些群体估计可能为负，也可能受抽样波动影响，不是个人获救概率或置信区间。
                  {r.intervention_validation.note}
                </p>
              </Panel>
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
                subtitle="按主模型风险（≥40%）× 当前渠道有效增益（≥4个百分点）划分；分组名称仅为估计，不保证流失或挽回"
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
