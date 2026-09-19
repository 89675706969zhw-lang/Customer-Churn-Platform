from contextlib import asynccontextmanager
from functools import lru_cache
from io import StringIO
from typing import Literal

import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .engine import (BASE_RETENTION_COST, CACHE, CHANNELS, CLV_MONTHS, LINES,
                     LABEL_MONTHS, OBS_MONTHS, REGIONS, ROOT, Engine)


@lru_cache
def engine():
    return Engine()


@asynccontextmanager
async def lifespan(app):
    engine()
    yield


app = FastAPI(title="Rostelecom 客户流失预警 API", version="1.0.0", lifespan=lifespan)


class Filters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    line: Literal["", "mobile", "broadband", "iptv", "fixed_voice"] = ""
    band: Literal["", "high", "mid", "low"] = ""
    region: str = Field(default="", max_length=50)
    search: str = Field(default="", max_length=80)


class Simulation(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    cost: float = Field(default=BASE_RETENTION_COST, gt=0, le=100000)
    success: float = Field(default=1.0, ge=0, le=2,
                           description="渠道效果系数：1.0=电话挽留基准（T-learner 增益的倍率）")
    max_k: int = Field(default=3000, ge=0, le=30000)
    clv_months: int = Field(default=CLV_MONTHS, ge=1, le=60)
    budget: float | None = Field(default=None, ge=0, le=1e10)
    filters: Filters = Field(default_factory=Filters)
    customer_ids: list[str] | None = Field(default=None, max_length=30000)


class ScoreRequest(BaseModel):
    customer_id: str


class BatchRequest(BaseModel):
    customer_ids: list[str] = Field(min_length=1, max_length=30000)


@app.get("/api/health")
def health():
    return dict(status="ok", version=engine().version, synthetic=True)


@app.get("/api/meta")
def meta():
    return dict(lines=LINES, regions=REGIONS, channels=CHANNELS, synthetic=True,
                obs_months=OBS_MONTHS, label_months=LABEL_MONTHS, clv_months=CLV_MONTHS)


@app.get("/api/dashboard")
def dashboard():
    return engine().dashboard()


@app.get("/api/customers/export")
def export(filters: Filters = Depends()):
    rows = engine().public(engine().filtered(**filters.model_dump()).sort_values("score", ascending=False))
    data = pd.DataFrame(rows).to_csv(index=False)
    return Response(content=("\ufeff" + data).encode("utf-8"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="churn-risk-list.csv"'})


@app.get("/api/customers")
def customers(filters: Filters = Depends(), page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
              sort: Literal["score", "customer_id", "arpu", "clv", "gain", "tenure_months"] = "score",
              direction: Literal["asc", "desc"] = "desc"):
    df = engine().filtered(**filters.model_dump()).sort_values([sort] + ([] if sort == "customer_id" else ["customer_id"]), ascending=direction == "asc")
    return dict(total=len(df), page=page, page_size=page_size, items=engine().public(df.iloc[(page - 1) * page_size:page * page_size]))


def ensure_customer(cid):
    if cid not in engine().positions:
        raise HTTPException(404, "客户编号不存在")


@app.get("/api/customers/{cid}")
def customer(cid: str):
    ensure_customer(cid)
    return engine().detail(cid)


@app.post("/api/score")
def score(body: ScoreRequest):
    ensure_customer(body.customer_id)
    return engine().public(engine().frame.iloc[[engine().positions[body.customer_id]]])[0]


@app.post("/api/batch_score")
def batch_score(body: BatchRequest):
    for cid in body.customer_ids:
        ensure_customer(cid)
    return dict(items=engine().public(engine().frame.iloc[[engine().positions[cid] for cid in body.customer_ids]]))


@app.post("/api/simulate")
def simulate(body: Simulation):
    try:
        return engine().simulate(body)
    except KeyError as exc:
        raise HTTPException(404, f"客户编号不存在: {exc.args[0]}") from exc


dist = ROOT / "frontend/dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
