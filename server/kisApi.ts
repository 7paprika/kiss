/**
 * KIS (Korea Investment & Securities) Open API Client
 * Supports both real (prod) and paper (vps) trading environments
 * Ref: https://apiportal.koreainvestment.com/
 */

import axios, { AxiosInstance } from "axios";

export type KisMode = "real" | "paper";

const KIS_BASE_URL: Record<KisMode, string> = {
  real: "https://openapi.koreainvestment.com:9443",
  paper: "https://openapivts.koreainvestment.com:29443",
};

const KIS_WS_URL: Record<KisMode, string> = {
  real: "ws://ops.koreainvestment.com:21000",
  paper: "ws://ops.koreainvestment.com:31000",
};

export interface KisCredentials {
  appKey: string;
  appSecret: string;
  accountNo: string;
  accountProduct: string;
  mode: KisMode;
}

export interface KisTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  access_token_token_expired: string;
}

export interface KisOHLCV {
  date: string;       // YYYYMMDD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;     // 거래금액
}

export interface KisCurrentPrice {
  stockCode: string;
  stockName: string;
  currentPrice: number;
  changePrice: number;
  changeRate: number;
  volume: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  prevClosePrice: number;
}

export interface KisBalance {
  stockCode: string;
  stockName: string;
  holdQty: number;
  avgPrice: number;
  currentPrice: number;
  evalAmount: number;
  profitLoss: number;
  profitLossRate: number;
}

export interface KisOrderResult {
  orderNo: string;
  orderTime: string;
  success: boolean;
  message: string;
}

export interface KisPendingOrder {
  orderNo: string;
  stockCode: string;
  stockName: string;
  orderType: "buy" | "sell";
  orderQty: number;
  orderPrice: number;
  executedQty: number;
  remainQty: number;
  orderTime: string;
}

// Rate limiter: KIS API allows ~20 requests/second
class RateLimiter {
  private queue: Array<() => void> = [];
  private running = 0;
  private readonly maxConcurrent: number;
  private readonly intervalMs: number;

  constructor(maxConcurrent = 15, intervalMs = 1000) {
    this.maxConcurrent = maxConcurrent;
    this.intervalMs = intervalMs;
  }

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      setTimeout(() => {
        this.running--;
        if (this.queue.length > 0) {
          const next = this.queue.shift();
          next?.();
        }
      }, this.intervalMs);
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.running++;
        setTimeout(() => {
          this.running--;
          if (this.queue.length > 0) {
            const next = this.queue.shift();
            next?.();
          }
        }, this.intervalMs);
        resolve();
      });
    });
  }
}

const rateLimiter = new RateLimiter(15, 1000);

export class KisApiClient {
  private credentials: KisCredentials;
  private accessToken: string = "";
  private tokenExpiredAt: Date | null = null;
  private client: AxiosInstance;

  constructor(credentials: KisCredentials) {
    this.credentials = credentials;
    this.client = axios.create({
      baseURL: KIS_BASE_URL[credentials.mode],
      timeout: 10000,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  setToken(token: string, expiredAt: Date) {
    this.accessToken = token;
    this.tokenExpiredAt = expiredAt;
  }

  isTokenValid(): boolean {
    if (!this.accessToken || !this.tokenExpiredAt) return false;
    return new Date() < new Date(this.tokenExpiredAt.getTime() - 60_000);
  }

  // 접근토큰 발급
  async getAccessToken(): Promise<KisTokenResponse> {
    const res = await axios.post(
      `${KIS_BASE_URL[this.credentials.mode]}/oauth2/tokenP`,
      {
        grant_type: "client_credentials",
        appkey: this.credentials.appKey,
        appsecret: this.credentials.appSecret,
      },
      { headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
    return res.data as KisTokenResponse;
  }

  // WebSocket 접속키 발급
  async getWsApprovalKey(): Promise<string> {
    const res = await axios.post(
      `${KIS_BASE_URL[this.credentials.mode]}/oauth2/Approval`,
      {
        grant_type: "client_credentials",
        appkey: this.credentials.appKey,
        secretkey: this.credentials.appSecret,
      },
      { headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
    return res.data.approval_key;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    trId: string,
    params?: Record<string, string>,
    body?: Record<string, unknown>
  ): Promise<T> {
    await rateLimiter.acquire();
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.accessToken}`,
      appkey: this.credentials.appKey,
      appsecret: this.credentials.appSecret,
      tr_id: trId,
      custtype: "P",
    };

    const config =
      method === "GET"
        ? { headers, params }
        : { headers, data: body };

    const res = method === "GET"
      ? await this.client.get(path, { headers, params })
      : await this.client.post(path, body, { headers });

    if (res.data.rt_cd && res.data.rt_cd !== "0") {
      throw new Error(`KIS API Error [${res.data.msg_cd}]: ${res.data.msg1}`);
    }
    return res.data as T;
  }

  // 주식 현재가 시세 조회
  async getCurrentPrice(stockCode: string): Promise<KisCurrentPrice> {
    const data = await this.request<{ output: Record<string, string> }>(
      "GET",
      "/uapi/domestic-stock/v1/quotations/inquire-price",
      "FHKST01010100",
      { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: stockCode }
    );
    const o = data.output;
    return {
      stockCode,
      stockName: o.hts_kor_isnm || "",
      currentPrice: Number(o.stck_prpr),
      changePrice: Number(o.prdy_vrss),
      changeRate: Number(o.prdy_ctrt),
      volume: Number(o.acml_vol),
      openPrice: Number(o.stck_oprc),
      highPrice: Number(o.stck_hgpr),
      lowPrice: Number(o.stck_lwpr),
      prevClosePrice: Number(o.stck_sdpr),
    };
  }

  // 국내주식 일/주/월봉 조회
  async getOHLCV(
    stockCode: string,
    period: "D" | "W" | "M" = "D",
    startDate?: string,
    endDate?: string
  ): Promise<KisOHLCV[]> {
    const today = new Date();
    const end = endDate || today.toISOString().slice(0, 10).replace(/-/g, "");
    const start = startDate || (() => {
      const d = new Date(today);
      d.setFullYear(d.getFullYear() - 1);
      return d.toISOString().slice(0, 10).replace(/-/g, "");
    })();

    const trIdMap = { D: "FHKST03010100", W: "FHKST03010100", M: "FHKST03010100" };
    const data = await this.request<{ output2: Array<Record<string, string>> }>(
      "GET",
      "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
      trIdMap[period],
      {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: stockCode,
        FID_INPUT_DATE_1: start,
        FID_INPUT_DATE_2: end,
        FID_PERIOD_DIV_CODE: period,
        FID_ORG_ADJ_PRC: "0",
      }
    );

    return (data.output2 || [])
      .filter((r) => r.stck_bsop_date)
      .map((r) => ({
        date: r.stck_bsop_date,
        open: Number(r.stck_oprc),
        high: Number(r.stck_hgpr),
        low: Number(r.stck_lwpr),
        close: Number(r.stck_clpr),
        volume: Number(r.acml_vol),
        amount: Number(r.acml_tr_pbmn),
      }))
      .reverse();
  }

  // 잔고 조회
  async getBalance(): Promise<{ holdings: KisBalance[]; totalEval: number; totalProfit: number }> {
    const data = await this.request<{
      output1: Array<Record<string, string>>;
      output2: Array<Record<string, string>>;
    }>(
      "GET",
      "/uapi/domestic-stock/v1/trading/inquire-balance",
      this.credentials.mode === "real" ? "TTTC8434R" : "VTTC8434R",
      {
        CANO: this.credentials.accountNo,
        ACNT_PRDT_CD: this.credentials.accountProduct,
        AFHR_FLPR_YN: "N",
        OFL_YN: "",
        INQR_DVSN: "02",
        UNPR_DVSN: "01",
        FUND_STTL_ICLD_YN: "N",
        FNCG_AMT_AUTO_RDPT_YN: "N",
        PRCS_DVSN: "01",
        CTX_AREA_FK100: "",
        CTX_AREA_NK100: "",
      }
    );

    const holdings: KisBalance[] = (data.output1 || [])
      .filter((r) => r.pdno)
      .map((r) => ({
        stockCode: r.pdno,
        stockName: r.prdt_name,
        holdQty: Number(r.hldg_qty),
        avgPrice: Number(r.pchs_avg_pric),
        currentPrice: Number(r.prpr),
        evalAmount: Number(r.evlu_amt),
        profitLoss: Number(r.evlu_pfls_amt),
        profitLossRate: Number(r.evlu_pfls_rt),
      }));

    const summary = data.output2?.[0] || {};
    return {
      holdings,
      totalEval: Number(summary.tot_evlu_amt || 0),
      totalProfit: Number(summary.evlu_pfls_smtl_amt || 0),
    };
  }

  // 주문 실행
  async placeOrder(
    stockCode: string,
    orderType: "buy" | "sell",
    quantity: number,
    price: number,
    priceType: "market" | "limit"
  ): Promise<KisOrderResult> {
    const isBuy = orderType === "buy";
    const trId = this.credentials.mode === "real"
      ? (isBuy ? "TTTC0802U" : "TTTC0801U")
      : (isBuy ? "VTTC0802U" : "VTTC0801U");

    const ordDvsn = priceType === "market" ? "01" : "00"; // 01=시장가, 00=지정가

    try {
      const data = await this.request<{ output: Record<string, string> }>(
        "POST",
        "/uapi/domestic-stock/v1/trading/order-cash",
        trId,
        undefined,
        {
          CANO: this.credentials.accountNo,
          ACNT_PRDT_CD: this.credentials.accountProduct,
          PDNO: stockCode,
          ORD_DVSN: ordDvsn,
          ORD_QTY: String(quantity),
          ORD_UNPR: priceType === "market" ? "0" : String(price),
        }
      );
      return {
        orderNo: data.output?.ODNO || "",
        orderTime: data.output?.ORD_TMD || "",
        success: true,
        message: "주문 성공",
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { orderNo: "", orderTime: "", success: false, message };
    }
  }

  // 미체결 주문 조회
  async getPendingOrders(): Promise<KisPendingOrder[]> {
    const data = await this.request<{ output: Array<Record<string, string>> }>(
      "GET",
      "/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl",
      this.credentials.mode === "real" ? "TTTC8036R" : "VTTC8036R",
      {
        CANO: this.credentials.accountNo,
        ACNT_PRDT_CD: this.credentials.accountProduct,
        CTX_AREA_FK100: "",
        CTX_AREA_NK100: "",
        INQR_DVSN_1: "0",
        INQR_DVSN_2: "0",
      }
    );

    return (data.output || []).map((r) => ({
      orderNo: r.odno,
      stockCode: r.pdno,
      stockName: r.prdt_name,
      orderType: r.sll_buy_dvsn_cd === "02" ? "buy" : "sell",
      orderQty: Number(r.ord_qty),
      orderPrice: Number(r.ord_unpr),
      executedQty: Number(r.tot_ccld_qty),
      remainQty: Number(r.rmn_qty),
      orderTime: r.ord_tmd,
    }));
  }

  // 주문 취소
  async cancelOrder(orgOrderNo: string, stockCode: string, quantity: number): Promise<boolean> {
    try {
      await this.request(
        "POST",
        "/uapi/domestic-stock/v1/trading/order-rvsecncl",
        this.credentials.mode === "real" ? "TTTC0803U" : "VTTC0803U",
        undefined,
        {
          CANO: this.credentials.accountNo,
          ACNT_PRDT_CD: this.credentials.accountProduct,
          KRX_FWDG_ORD_ORGNO: "",
          ORGN_ODNO: orgOrderNo,
          ORD_DVSN: "00",
          RVSE_CNCL_DVSN_CD: "02", // 02=취소
          ORD_QTY: String(quantity),
          ORD_UNPR: "0",
          QTY_ALL_ORD_YN: "Y",
          PDNO: stockCode,
        }
      );
      return true;
    } catch {
      return false;
    }
  }

  // 종목 검색 (종목명으로)
  async searchStock(keyword: string): Promise<Array<{ code: string; name: string; market: string }>> {
    try {
      const data = await this.request<{ output: Array<Record<string, string>> }>(
        "GET",
        "/uapi/domestic-stock/v1/quotations/search-stock-info",
        "CTPF1002R",
        {
          PRDT_TYPE_CD: "300",
          PDNO: keyword,
        }
      );
      return (data.output || []).slice(0, 20).map((r) => ({
        code: r.pdno || r.shtn_pdno,
        name: r.prdt_abrv_name || r.prdt_name,
        market: r.mket_id_cd || "J",
      }));
    } catch {
      return [];
    }
  }

  getWsUrl(): string {
    return KIS_WS_URL[this.credentials.mode];
  }
}

// 싱글톤 클라이언트 캐시 (userId별)
const clientCache = new Map<number, KisApiClient>();

export function getKisClient(userId: number): KisApiClient | null {
  return clientCache.get(userId) || null;
}

export function setKisClient(userId: number, client: KisApiClient): void {
  clientCache.set(userId, client);
}

export function removeKisClient(userId: number): void {
  clientCache.delete(userId);
}
