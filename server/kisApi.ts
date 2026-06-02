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

export interface KisCurrentPriceDetail extends KisCurrentPrice {
  code: string;
  name: string;
  market: string;
  price: number;
  amount: number;
  statusCode?: string;
  warningCode?: string;
  halted?: boolean;
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

export interface KisAccountBalance {
  holdings: KisBalance[];
  totalEval: number;
  totalProfit: number;
  cashBalance: number;
  withdrawableCash: number;
  purchasePower: number;
}

export interface KisRankCandidate {
  code: string;
  name: string;
  market: string;
  price: number;
  changeRate: number;
  volume: number;
  amount: number;
  rank?: number;
}

export interface KisRankCandidateOptions {
  minPrice?: number;
  maxPrice?: number;
  minVolume?: number;
  sort?: "volume" | "amount" | "turnover" | "change";
  market?: "KRX" | "NXT" | "ALL";
  count?: number;
}

export interface KisOrderResult {
  orderNo: string;
  orderTime: string;
  success: boolean;
  message: string;
}

export type KisTradeMode = "cash" | "credit";
export type KisCreditType = "21" | "23" | "25" | "27";

export interface KisOrderOptions {
  tradeMode?: KisTradeMode;
  creditType?: KisCreditType;
  loanDate?: string;
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

export interface KisOrderbookLevel {
  price: number;
  quantity: number;
}

export interface KisOrderbook {
  stockCode: string;
  currentPrice: number;
  totalAskQty: number;
  totalBidQty: number;
  asks: KisOrderbookLevel[];  // 매도호가 1~10 (낮은 가격부터)
  bids: KisOrderbookLevel[];  // 매수호가 1~10 (높은 가격부터)
  timestamp: number;
}

const KIS_RATE_LIMIT_CODE = "EGW00201";

export function sanitizeKisApiError(error: unknown): Error {
  const anyError = error as any;
  const response = anyError?.response;
  const data = response?.data || {};
  const msgCd = data.msg_cd || data.message || data.code || anyError?.code;
  const msg = data.msg1 || data.msg || anyError?.message || "KIS API request failed";
  const status = response?.status;
  const method = anyError?.config?.method?.toUpperCase?.();
  const url = anyError?.config?.url || anyError?.config?.baseURL || "";
  const safeParts = [
    "KIS API Error",
    msgCd ? `[${msgCd}]` : "",
    status ? `(HTTP ${status})` : "",
    method ? method : "",
    typeof url === "string" ? url.split("?")[0] : "",
    msg ? `: ${msg}` : "",
  ].filter(Boolean);
  const sanitized = new Error(safeParts.join(" ").replace(/\s+:/, ":"));
  sanitized.name = "KisApiError";
  if (msgCd) (sanitized as any).code = msgCd;
  if (status) (sanitized as any).status = status;
  return sanitized;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Conservative token-bucket limiter. KIS may reject bursts even below the documented ceiling,
// especially when realtime polling and batch screeners run together.
class RateLimiter {
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly minSpacingMs = 180) {}

  async acquire(): Promise<void> {
    const previous = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    setTimeout(release, this.minSpacingMs);
  }
}

const rateLimiter = new RateLimiter(180);

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
    ).catch((error) => {
      throw sanitizeKisApiError(error);
    });
    return res.data as KisTokenResponse;
  }

  private parseTokenExpiry(token: KisTokenResponse): Date {
    const explicitExpiry = token.access_token_token_expired?.replace(" ", "T");
    if (explicitExpiry) {
      const parsed = new Date(explicitExpiry);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date(Date.now() + Math.max(0, token.expires_in || 0) * 1000);
  }

  async ensureAccessToken(): Promise<string> {
    if (this.isTokenValid()) return this.accessToken;
    const token = await this.getAccessToken();
    this.setToken(token.access_token, this.parseTokenExpiry(token));
    return this.accessToken;
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
    ).catch((error) => {
      throw sanitizeKisApiError(error);
    });
    return res.data.approval_key;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    trId: string,
    params?: Record<string, string>,
    body?: Record<string, unknown>
  ): Promise<T> {
    const requestOnce = async () => {
      await rateLimiter.acquire();
      await this.ensureAccessToken();
      const headers: Record<string, string> = {
        authorization: `Bearer ${this.accessToken}`,
        appkey: this.credentials.appKey,
        appsecret: this.credentials.appSecret,
        tr_id: trId,
        custtype: "P",
      };

      const res = method === "GET"
        ? await this.client.get(path, { headers, params, validateStatus: () => true })
        : await this.client.post(path, body, { headers, validateStatus: () => true });

      if (res.status >= 400 || (res.data?.rt_cd && res.data.rt_cd !== "0")) {
        throw sanitizeKisApiError({
          response: { status: res.status, data: res.data },
          config: { method, url: path },
        });
      }
      return res.data as T;
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await requestOnce();
      } catch (error) {
        const safeError = sanitizeKisApiError(error);
        if ((safeError as any).code === KIS_RATE_LIMIT_CODE && attempt < 2) {
          await sleep(600 * (attempt + 1));
          continue;
        }
        throw safeError;
      }
    }

    throw new Error("KIS API Error: retry exhausted");
  }

  // 주식 현재가 시세 조회
  async getCurrentPrice(stockCode: string): Promise<KisCurrentPrice> {
    const detail = await this.getCurrentPriceDetail(stockCode);
    return {
      stockCode: detail.stockCode,
      stockName: detail.stockName,
      currentPrice: detail.currentPrice,
      changePrice: detail.changePrice,
      changeRate: detail.changeRate,
      volume: detail.volume,
      openPrice: detail.openPrice,
      highPrice: detail.highPrice,
      lowPrice: detail.lowPrice,
      prevClosePrice: detail.prevClosePrice,
    };
  }

  // 주식 현재가 + 전체시장 필터용 원시 상태 정보
  async getCurrentPriceDetail(stockCode: string): Promise<KisCurrentPriceDetail> {
    const data = await this.request<{ output: Record<string, string> }>(
      "GET",
      "/uapi/domestic-stock/v1/quotations/inquire-price",
      "FHKST01010100",
      { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: stockCode }
    );
    const o = data.output;
    const currentPrice = Number(o.stck_prpr);
    const volume = Number(o.acml_vol);
    const stockName = o.hts_kor_isnm || "";
    const statusCode = o.iscd_stat_cls_code || o.stck_stat_cls_code || o.mrkt_warn_cls_code || undefined;
    const warningCode = o.mrkt_warn_cls_code || o.invt_caful_yn || undefined;
    const halted = [o.trht_yn, o.halt_yn, o.tr_susp_yn].some((value) => value === "Y" || value === "1");
    return {
      stockCode,
      code: stockCode,
      stockName,
      name: stockName,
      market: "KRX",
      currentPrice,
      price: currentPrice,
      changePrice: Number(o.prdy_vrss),
      changeRate: Number(o.prdy_ctrt),
      volume,
      amount: Number(o.acml_tr_pbmn || 0) || currentPrice * volume,
      openPrice: Number(o.stck_oprc),
      highPrice: Number(o.stck_hgpr),
      lowPrice: Number(o.stck_lwpr),
      prevClosePrice: Number(o.stck_sdpr),
      statusCode,
      warningCode,
      halted,
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

  // 거래량/거래대금 순위 기반 후보 조회
  async getVolumeRankCandidates(options: KisRankCandidateOptions = {}): Promise<KisRankCandidate[]> {
    const minPrice = options.minPrice ?? 1000;
    const maxPrice = options.maxPrice ?? 1000000;
    const minVolume = options.minVolume ?? 50000;
    const sortMap: Record<NonNullable<KisRankCandidateOptions["sort"]>, string> = {
      volume: "0",
      amount: "3",
      turnover: "2",
      change: "1",
    };
    const marketMap: Record<NonNullable<KisRankCandidateOptions["market"]>, string> = {
      KRX: "J",
      NXT: "NX",
      ALL: "UN",
    };

    const data = await this.request<{ output: Array<Record<string, string>> }>(
      "GET",
      "/uapi/domestic-stock/v1/quotations/volume-rank",
      "FHPST01710000",
      {
        FID_COND_MRKT_DIV_CODE: marketMap[options.market ?? "KRX"],
        FID_COND_SCR_DIV_CODE: "20171",
        FID_INPUT_ISCD: "0000",
        FID_DIV_CLS_CODE: "1",
        FID_BLNG_CLS_CODE: sortMap[options.sort ?? "amount"],
        FID_TRGT_CLS_CODE: "111111111",
        // 투자위험/경고/주의, 관리종목, 정리매매, 불성실공시, 우선주, 거래정지, ETF, ETN, 신용주문불가, SPAC 제외
        FID_TRGT_EXLS_CLS_CODE: "1111111111",
        FID_INPUT_PRICE_1: String(minPrice),
        FID_INPUT_PRICE_2: String(maxPrice),
        FID_VOL_CNT: String(minVolume),
        FID_INPUT_DATE_1: "",
      }
    );

    const rows = (data.output || []).map((r, index) => {
      const code = r.mksc_shrn_iscd || r.stck_shrn_iscd || r.pdno || r.iscd || "";
      const name = r.hts_kor_isnm || r.prdt_name || r.prdt_abrv_name || code;
      const price = Number(r.stck_prpr || r.prpr || r.now_pric || 0);
      const volume = Number(r.acml_vol || r.vol || 0);
      const amount = Number(r.acml_tr_pbmn || r.tr_pbmn || (price * volume));
      const changeRate = Number(r.prdy_ctrt || r.flt_rt || r.prdy_vrss_sign_rate || 0);
      return {
        code,
        name,
        market: options.market === "NXT" ? "NXT" : "KRX",
        price,
        changeRate,
        volume,
        amount,
        rank: Number(r.data_rank || r.rank || index + 1),
      };
    }).filter((row) => /^\d{6}$/.test(row.code));

    return typeof options.count === "number" ? rows.slice(0, options.count) : rows;
  }

  // 잔고 조회
  async getBalance(): Promise<KisAccountBalance> {
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
    const cashBalance = Number(summary.dnca_tot_amt || summary.dnca_tota || summary.cash || 0);
    const withdrawableCash = Number(summary.nxdy_excc_amt || summary.prvs_rcdl_excc_amt || summary.d2_auto_rdpt_amt || 0);
    return {
      holdings,
      totalEval: Number(summary.tot_evlu_amt || 0),
      totalProfit: Number(summary.evlu_pfls_smtl_amt || 0),
      cashBalance,
      withdrawableCash,
      purchasePower: Number(summary.nass_amt || summary.ord_psbl_cash || withdrawableCash || cashBalance),
    };
  }

  // 주문 실행
  async placeOrder(
    stockCode: string,
    orderType: "buy" | "sell",
    quantity: number,
    price: number,
    priceType: "market" | "limit",
    options: KisOrderOptions = {}
  ): Promise<KisOrderResult> {
    const isBuy = orderType === "buy";
    const tradeMode = options.tradeMode ?? "cash";
    const ordDvsn = priceType === "market" ? "01" : "00"; // 01=시장가, 00=지정가

    if (tradeMode === "credit" && this.credentials.mode !== "real") {
      return {
        orderNo: "",
        orderTime: "",
        success: false,
        message: "KIS 신용주문은 모의투자에서 지원되지 않아 실전투자 계좌에서만 사용할 수 있습니다.",
      };
    }

    const trId = tradeMode === "credit"
      ? (isBuy ? "TTTC0052U" : "TTTC0051U")
      : this.credentials.mode === "real"
        ? (isBuy ? "TTTC0802U" : "TTTC0801U")
        : (isBuy ? "VTTC0802U" : "VTTC0801U");
    const path = tradeMode === "credit"
      ? "/uapi/domestic-stock/v1/trading/order-credit"
      : "/uapi/domestic-stock/v1/trading/order-cash";

    const body: Record<string, unknown> = {
      CANO: this.credentials.accountNo,
      ACNT_PRDT_CD: this.credentials.accountProduct,
      PDNO: stockCode,
      ORD_DVSN: ordDvsn,
      ORD_QTY: String(quantity),
      ORD_UNPR: priceType === "market" ? "0" : String(price),
    };

    if (tradeMode === "credit") {
      body.CRDT_TYPE = options.creditType;
      body.LOAN_DT = options.loanDate;
      body.RSVN_ORD_YN = "N";
    }

    try {
      const data = await this.request<{ output: Record<string, string> }>(
        "POST",
        path,
        trId,
        undefined,
        body
      );
      return {
        orderNo: data.output?.ODNO || data.output?.odno || "",
        orderTime: data.output?.ORD_TMD || data.output?.ord_tmd || "",
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

  // 호가 조회 (10단계)
  async getOrderbook(stockCode: string): Promise<KisOrderbook> {
    const data = await this.request<{ output1: Record<string, string>; output2: Array<Record<string, string>> }>(
      "GET",
      "/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn",
      "FHKST01010200",
      { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: stockCode }
    );
    const o = data.output1 || {};
    const asks: KisOrderbookLevel[] = [];
    const bids: KisOrderbookLevel[] = [];
    for (let i = 1; i <= 10; i++) {
      const n = String(i).padStart(2, "0");
      asks.push({
        price: Number(o[`askp${n}`] || o[`매도호가${i}`] || 0),
        quantity: Number(o[`askp_rsqn${n}`] || o[`매도잔량${i}`] || 0),
      });
      bids.push({
        price: Number(o[`bidp${n}`] || o[`매수호가${i}`] || 0),
        quantity: Number(o[`bidp_rsqn${n}`] || o[`매수잔량${i}`] || 0),
      });
    }
    return {
      stockCode,
      currentPrice: Number(o.stck_prpr || 0),
      totalAskQty: Number(o.total_askp_rsqn || 0),
      totalBidQty: Number(o.total_bidp_rsqn || 0),
      asks,
      bids,
      timestamp: Date.now(),
    };
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
