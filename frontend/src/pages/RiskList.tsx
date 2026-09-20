import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { ArrowRight, ArrowUpDown, ChevronLeft, ChevronRight, Download, Search, RotateCcw } from "lucide-react";
import { api, queryString, number, money, percent, type Customer, type CustomerPage, type Filters, type Meta, type Selection } from "../api";
import { Button } from "../components/ui/button";
import { useDebounce } from "../hooks";
import { Status, Badge, PageHead } from "../components/shared";

export default function RiskList({
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
