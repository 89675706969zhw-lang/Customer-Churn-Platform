import { useEffect, useState } from "react";
import { NavLink, Route, Routes, Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, FlaskConical, LayoutDashboard, ListFilter, Users } from "lucide-react";
import { api, emptyFilters, type Meta, type Selection } from "./api";
import { Button } from "./components/ui/button";
import { Status } from "./components/shared";
import Overview from "./pages/Overview";
import RiskList from "./pages/RiskList";
import Diagnosis from "./pages/Diagnosis";
import Simulation from "./pages/Simulation";

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
