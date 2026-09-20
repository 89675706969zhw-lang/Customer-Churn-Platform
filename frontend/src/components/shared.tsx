import { type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "./ui/button";

export function Panel({
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
export function Status({
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
export function Kpi({
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
export function Badge({ band }: { band: string }) {
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
export function PageHead({
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
