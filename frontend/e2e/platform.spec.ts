import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CustomerPage, Detail, Meta, SimResult } from "../src/api";

const money = (value: number) => `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)} ₽`;

function watchSimulation(page: Page, budget?: number) {
  return page.waitForResponse((response) =>
    response.url().endsWith("/api/simulate") && response.request().method() === "POST" &&
    (budget === undefined || response.request().postDataJSON().budget === budget),
  );
}

test("overview → filtered list → CSV → diagnosis → simulation → reload", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /洞察流失风险/ })).toBeVisible();
  await expect(page.getByRole("img", { name: "标签窗口逐月流失事件率" })).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "查看风险名单" }).click();
  await expect(page.getByRole("heading", { name: "客户风险名单" })).toBeVisible();
  await page.getByRole("combobox", { name: "业务线" }).selectOption("broadband");
  const filteredResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/customers" && url.searchParams.get("line") === "broadband" && url.searchParams.get("region") === "Moscow";
  });
  await page.getByRole("combobox", { name: "所属区域" }).selectOption("Moscow");
  const filtered = await (await filteredResponse).json() as CustomerPage;
  expect(filtered.items.length).toBeGreaterThan(0);
  expect(filtered.items.every((c) => c.business_line === "broadband" && c.region === "Moscow")).toBe(true);
  const cid = filtered.items[0].customer_id;
  await expect(page.getByRole("link", { name: cid, exact: true })).toBeVisible();
  await expect(page.getByText(`共 ${new Intl.NumberFormat("zh-CN").format(filtered.total)} 位客户`)).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("churn-risk-list.csv");
  expect(await download.failure()).toBeNull();
  const csv = (await readFile((await download.path())!, "utf8")).replace(/^\uFEFF/, "");
  const rows = csv.trim().split(/\r?\n/);
  expect(rows.length - 1).toBe(filtered.total);
  const columns = rows[0].split(",");
  expect(columns).toContain("customer_id");
  for (const row of rows.slice(1)) {
    const values = row.split(",");
    expect(values[columns.indexOf("business_line")]).toBe("broadband");
    expect(values[columns.indexOf("region")]).toBe("Moscow");
  }
  expect(csv).toContain(cid);

  await page.getByRole("link", { name: cid, exact: true }).click();
  await expect(page.getByRole("heading", { name: "客户画像" })).toBeVisible();
  await expect(page.locator(".customer-head")).toContainText(cid);
  const customerResponse = await request.get(`/api/customers/${cid}`);
  expect(customerResponse.ok()).toBe(true);
  const customer = await customerResponse.json() as Detail;
  await expect(page.locator(".score-card")).toContainText(`${(customer.score * 100).toFixed(1)}%`);
  // ECharts supplies a data-dependent ARIA description; the panel title is stable.
  const shapPanel = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "风险归因 · SHAP", exact: true }) });
  await expect(shapPanel.locator("canvas")).toBeVisible();

  const simulationResponse = watchSimulation(page);
  await page.getByRole("button", { name: "加入干预仿真" }).click();
  const response = await simulationResponse;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON().customer_ids).toEqual([cid]);
  expect(response.request().postDataJSON().success).toBe(1);
  const result = await response.json() as SimResult;
  expect(result.candidate_count).toBe(1);
  expect(result.intervention_validation.holdout_size).toBe(7500);
  await expect(page.getByRole("heading", { name: "干预模型 · 样本外验证" })).toBeVisible();
  for (const row of result.customers) {
    expect(row.p_after).toBeGreaterThanOrEqual(0);
    expect(row.p_after).toBeLessThanOrEqual(1);
    expect(row.rescue).toBeCloseTo(row.p0 - row.p_after, 10);
  }
  await expect(page.getByText("手选客户 · 1 人", { exact: true })).toBeVisible();
  await expect(page.locator(".sim-kpis")).toContainText(money(result.net));

  const restoredResponse = watchSimulation(page);
  await page.reload();
  expect((await restoredResponse).request().postDataJSON().customer_ids).toEqual([cid]);
  await expect(page.getByText("手选客户 · 1 人", { exact: true })).toBeVisible();
  // Check the page itself fits; wide tables may scroll inside their own container.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test("telephone defaults, channel change, and zero-budget simulation use the real API", async ({ page, request }) => {
  const metadata = await (await request.get("/api/meta")).json() as Meta;
  const call = metadata.channels.find((channel) => channel.id === "call")!;
  const sms = metadata.channels.find((channel) => channel.id === "sms")!;
  const initialResponse = watchSimulation(page);
  await page.goto("/#/simulation");
  expect((await initialResponse).request().postDataJSON()).toMatchObject({ cost: call.cost, success: call.success, clv_months: metadata.clv_months });
  await expect(page.getByRole("slider", { name: /渠道效果系数/ })).toHaveValue(String(call.success));
  await expect(page.getByRole("button", { name: /人工电话/ })).toHaveAttribute("aria-pressed", "true");

  const smsResponse = watchSimulation(page);
  await page.getByRole("button", { name: /短信与推送/ }).click();
  expect((await smsResponse).request().postDataJSON()).toMatchObject({ cost: sms.cost, success: sms.success });
  await expect(page.getByRole("slider", { name: /单次干预成本/ })).toHaveValue(String(sms.cost));

  const zeroResponse = watchSimulation(page, 0);
  await page.getByRole("spinbutton", { name: /预算上限/ }).fill("0");
  expect(await (await zeroResponse).json()).toMatchObject({ best_k: 0, net: 0, cost: 0, roi: null, customers: [] });
  await expect(page.getByText("无需按当前参数执行干预。")).toBeVisible();
});

test("pagination and empty search recover through the UI", async ({ page }) => {
  await page.goto("/#/customers");
  const first = page.locator("tbody tr").first().getByRole("link");
  await expect(first).toBeVisible();
  const firstId = await first.innerText();
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.locator(".pagination")).toContainText("第 2 /");
  await expect(first).not.toHaveText(firstId);
  await page.getByPlaceholder("搜索 RT-000001…").fill("DOES-NOT-EXIST");
  await expect(page.getByRole("heading", { name: "没有匹配的客户" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 CSV" })).toBeDisabled();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(first).toHaveText(firstId);
  await expect(page.getByRole("button", { name: "上一页" })).toBeDisabled();
});

test("validation remains readable at narrow and landscape widths with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/simulation");
  await expect(page.getByRole("heading", { name: "干预模型 · 样本外验证" })).toBeVisible();
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    // ECharts updates its canvas via ResizeObserver after the viewport changes.
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect(page.getByRole("slider", { name: /渠道效果系数/ })).toBeEnabled();
    const heading = page.getByRole("heading", { name: "干预模型 · 样本外验证" });
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeVisible();
    if (process.env.CHURN_VISUAL_CHECKS) {
      await page.screenshot({ path: `../output/playwright/validation-${viewport.width}.png`, fullPage: true });
      await page.locator(".panel").filter({ has: heading }).screenshot({ path: `../output/playwright/validation-panel-${viewport.width}.png` });
    }
  }
});
