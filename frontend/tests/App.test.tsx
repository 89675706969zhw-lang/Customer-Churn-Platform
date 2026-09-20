import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { emptyFilters, type Meta, type SimParams } from "../src/api";
import { customer, dashboard, detail, meta, selection, simulation } from "./fixtures";

// jsdom has no canvas layout; real ECharts rendering is exercised by E2E tests.
vi.mock("../src/Chart", () => ({
  palette: ["#7700ff", "#059669", "#ed8b23", "#e04c64"],
  Chart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));

let metadata: Meta;
let requests: URL[];
let simulations: SimParams[];
let metadataFailures: number;
let exportFails: boolean;
const clients: QueryClient[] = [];

beforeEach(() => {
  metadata = structuredClone(meta);
  requests = [];
  simulations = [];
  metadataFailures = 0;
  exportFails = false;
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const url = new URL(path, "http://localhost");
    requests.push(url);
    if (url.pathname === "/api/meta") {
      if (metadataFailures-- > 0) return Response.json({ detail: "服务暂不可用" }, { status: 503 });
      return Response.json(metadata);
    }
    if (url.pathname === "/api/dashboard") return Response.json(dashboard);
    if (url.pathname === "/api/customers/export") {
      return new Response("", { status: exportFails ? 500 : 200 });
    }
    if (url.pathname === "/api/customers") {
      const page = Number(url.searchParams.get("page") || 1);
      const search = url.searchParams.get("search") || "";
      const line = url.searchParams.get("line") || "mobile";
      const items = Array.from({ length: page === 3 ? 1 : 20 }, (_, i) =>
        customer(`RT-${String((page - 1) * 20 + i + 1).padStart(6, "0")}`, line));
      return Response.json({ total: search ? 0 : 41, page, page_size: 20, items: search ? [] : items });
    }
    if (url.pathname === "/api/customers/RT-000001") return Response.json(detail);
    if (url.pathname === "/api/simulate") {
      const input = JSON.parse(String(init?.body)) as SimParams;
      simulations.push(input);
      return Response.json(simulation(input));
    }
    throw new Error(`Unexpected request: ${path}`);
  }));
});

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

function mount(path = "/customers") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
    </QueryClientProvider>,
  );
}

function lastCustomerRequest() {
  return requests.filter((url) => url.pathname === "/api/customers").at(-1)!.searchParams;
}

it("identifies B2 as the current model without claiming it is metric-best", async () => {
  mount("/");
  expect(await screen.findByText("当前演示模型验证 · B2 LightGBM")).toBeVisible();
  expect(screen.getByText(/平台当前沿用 B2 LightGBM/)).toHaveTextContent(
    "并非本次指标最优模型",
  );
  expect(screen.getByText(/平台当前沿用 B2 LightGBM/)).toHaveTextContent(
    "B1 与 B3 的主要排序指标略高",
  );
});

it("shows out-of-sample validation, negative ranking metrics and adjusted channel effects", async () => {
  mount("/simulation");
  await screen.findByRole("heading", { name: "干预模型 · 样本外验证" });
  expect(screen.getByText(/Qini（IPW）-0.0123/)).toBeVisible();
  expect(screen.getByText(/样本外估计不代表真实业务效果/)).toBeVisible();
  expect(screen.getByText(/将「未干预概率/)).toBeVisible();
  const tile = screen.getByText("候选平均有效增益").closest(".kpi")! as HTMLElement;
  expect(within(tile).getByText("10.0%")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: /短信与推送/ }));
  await waitFor(() => expect(screen.getByText("候选平均有效增益").closest(".kpi")).toHaveTextContent("3.5%"));
});

describe("loading and recovery", () => {
  it("shows loading, exposes a failed request, and reloads successfully", async () => {
    metadataFailures = 1;
    mount();
    expect(screen.getByRole("status")).toHaveTextContent("正在加载数据");
    expect(await screen.findByRole("alert")).toHaveTextContent("服务暂不可用");
    await userEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByRole("link", { name: "RT-000001" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("risk list", () => {
  it("paginates, resets the page when filtering, and sends sorting parameters", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("link", { name: "RT-000001" });
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByRole("link", { name: "RT-000021" });
    expect(screen.queryByRole("link", { name: "RT-000001" })).not.toBeInTheDocument();
    expect(lastCustomerRequest().get("page")).toBe("2");
    await user.selectOptions(screen.getByRole("combobox", { name: "业务线" }), "broadband");
    await screen.findByRole("link", { name: "RT-000001" });
    expect(lastCustomerRequest().get("page")).toBe("1");
    expect(lastCustomerRequest().get("line")).toBe("broadband");
    expect(within(screen.getAllByRole("row")[1]).getByText("固定宽带")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "流失风险" }));
    await waitFor(() => expect(lastCustomerRequest().get("direction")).toBe("asc"));
    expect(lastCustomerRequest().get("sort")).toBe("score");
    expect(screen.getByRole("columnheader", { name: "流失风险" })).toHaveAttribute("aria-sort", "ascending");
  });

  it("debounces a search, handles an empty result, and clears filters", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("link", { name: "RT-000001" });
    await user.type(screen.getByPlaceholderText("搜索 RT-000001…"), "MISSING");
    expect(await screen.findByRole("heading", { name: "没有匹配的客户" })).toBeVisible();
    expect(lastCustomerRequest().get("search")).toBe("MISSING");
    expect(screen.getByRole("button", { name: "导出 CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "纳入干预仿真" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(await screen.findByRole("link", { name: "RT-000001" })).toBeVisible();
    expect(screen.getByPlaceholderText("搜索 RT-000001…")).toHaveValue("");
  });

  it("passes filtered customers to simulation and persists the selection", async () => {
    mount("/customers?line=broadband&region=Moscow&band=high");
    await screen.findByRole("link", { name: "RT-000001" });
    await userEvent.click(screen.getByRole("button", { name: "纳入干预仿真" }));
    await screen.findByText("筛选名单 · 41 人");
    await waitFor(() => expect(simulations).toHaveLength(1));
    expect(simulations[0]).toMatchObject({ filters: { line: "broadband", region: "Moscow", band: "high", search: "" }, customer_ids: null });
    expect(JSON.parse(sessionStorage.getItem("churn-selection")!)).toMatchObject({ name: "筛选名单 · 41 人", customer_ids: null });
  });

  it("shows an export error and re-enables the export button", async () => {
    exportFails = true;
    mount();
    await screen.findByRole("link", { name: "RT-000001" });
    await userEvent.click(screen.getByRole("button", { name: "导出 CSV" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("导出失败，请重试");
    expect(screen.getByRole("button", { name: "导出 CSV" })).toBeEnabled();
  });
});

describe("diagnosis and selection", () => {
  it("adds a diagnosed customer without duplicating an existing selection", async () => {
    sessionStorage.setItem("churn-selection", JSON.stringify(selection));
    mount("/customers/RT-000001");
    await screen.findByRole("heading", { name: "客户画像" });
    await userEvent.click(screen.getByRole("button", { name: "加入干预仿真" }));
    await waitFor(() => expect(simulations).toHaveLength(1));
    expect(simulations[0].customer_ids).toEqual(["RT-000001"]);
    expect(screen.getByText("手选客户 · 1 人")).toBeVisible();
  });

  it("restores the stored selection and can reset it to all customers", async () => {
    sessionStorage.setItem("churn-selection", JSON.stringify(selection));
    mount("/simulation");
    await waitFor(() => expect(simulations).toHaveLength(1));
    expect(simulations[0].customer_ids).toEqual(["RT-000001"]);
    await userEvent.click(screen.getByRole("button", { name: "恢复全部客户" }));
    await waitFor(() => expect(simulations.at(-1)?.customer_ids).toBeNull());
    expect(JSON.parse(sessionStorage.getItem("churn-selection")!)).toEqual({ filters: emptyFilters, customer_ids: null, name: "全部客户" });
  });

  it.each(["{broken", "null", '{"name":42}'])("ignores invalid stored selection: %s", async (stored) => {
    sessionStorage.setItem("churn-selection", stored);
    mount("/simulation");
    await waitFor(() => expect(simulations).toHaveLength(1));
    expect(simulations[0]).toMatchObject({ filters: emptyFilters, customer_ids: null });
    expect(screen.getByText("全部客户")).toBeVisible();
  });
});

describe("simulation", () => {
  it("uses the selected telephone channel's metadata for the very first request", async () => {
    mount("/simulation");
    await waitFor(() => expect(simulations).toHaveLength(1));
    expect(screen.getByRole("button", { name: /人工电话/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("slider", { name: /渠道效果系数/ })).toHaveValue("1");
    expect(simulations[0]).toMatchObject({ cost: 800, success: 1, clv_months: 18 });
  });

  it("reads defaults from metadata rather than hard-coded frontend constants", async () => {
    metadata.channels[0] = { ...metadata.channels[0], cost: 900, success: 1.2 };
    metadata.clv_months = 24;
    mount("/simulation");
    await waitFor(() => expect(simulations).toHaveLength(1));
    expect(simulations[0]).toMatchObject({ cost: 900, success: 1.2, clv_months: 24 });
  });

  it("changes both the displayed controls and request when switching channels", async () => {
    mount("/simulation");
    await waitFor(() => expect(simulations).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: /短信与推送/ }));
    expect(screen.getByRole("slider", { name: /单次干预成本/ })).toHaveValue("80");
    expect(screen.getByRole("slider", { name: /渠道效果系数/ })).toHaveValue("0.35");
    await waitFor(() => expect(simulations.at(-1)).toMatchObject({ cost: 80, success: 0.35 }));
    expect(screen.getByRole("button", { name: /短信与推送/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("blocks invalid budgets, handles zero budget, and recovers when cleared", async () => {
    mount("/simulation");
    await waitFor(() => expect(simulations).toHaveLength(1));
    const budget = screen.getByRole("spinbutton", { name: /预算上限/ });
    fireEvent.change(budget, { target: { value: "-1" } });
    expect(screen.getByText("预算须为 0 至 100 亿之间的数值。")).toBeVisible();
    // Allow the debounce window to elapse: invalid input must never reach the API.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(simulations).toHaveLength(1);
    fireEvent.change(budget, { target: { value: "0" } });
    expect(await screen.findByText("无需按当前参数执行干预。")).toBeVisible();
    expect(simulations.at(-1)?.budget).toBe(0);
    fireEvent.change(budget, { target: { value: "" } });
    await screen.findByRole("link", { name: "RT-000001" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
