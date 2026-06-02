import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Settings2, Zap, Target, Play, Square, Info, Link2, ShieldAlert, TrendingUp, TrendingDown, CreditCard } from "lucide-react";

type StrategyGuide = {
  core: string;
  logic: string[];
  effective: string[];
  caution: string[];
  tip: string;
};

const strategyGuides: Record<string, StrategyGuide> = {
  momentum_selection: {
    core: "최근 일정 기간 동안 가격 상승률과 거래회전율이 함께 강해진 종목을 우선 후보로 고르는 추세 지속형 종목 선정 전략입니다.",
    logic: ["lookbackDays 동안의 수익률을 계산해 단기 가격 모멘텀을 측정합니다.", "거래량·거래대금이 동반되는 종목을 더 높은 점수로 평가해 단순 반등보다 수급이 붙은 상승을 선호합니다.", "minScore 미만 후보는 제외해 자동매매 대상 종목 수를 줄입니다."],
    effective: ["시장 전체가 상승 추세이거나 주도 섹터가 뚜렷할 때", "거래대금이 증가하면서 신고가·전고점 돌파 종목이 확산될 때", "급등 하루가 아니라 여러 거래일에 걸친 상승 흐름이 이어질 때"],
    caution: ["뉴스성 급등 후 거래량이 마르는 종목은 추격매수 위험이 큽니다.", "박스권 장세에서는 고점 매수 후 되돌림이 잦을 수 있습니다.", "갭 상승 직후에는 손절폭과 주문금액을 보수적으로 둬야 합니다."],
    tip: "상승장에서는 lookbackDays를 짧게, 변동성이 큰 장에서는 minScore를 높여 후보를 줄이는 방식이 안정적입니다.",
  },
  momentum_trading: {
    core: "단기 수익률이 entryThreshold 이상이면 상승 탄력이 지속된다고 보고 매수하고, exitThreshold 아래로 약해지면 매도하는 추세추종 실행 전략입니다.",
    logic: ["period 동안의 종가 변화율을 계산합니다.", "변화율이 진입 기준을 넘으면 BUY, 이탈 기준보다 약하면 SELL, 중간 구간은 HOLD를 반환합니다.", "신호 강도는 기준치를 얼마나 크게 초과했는지로 산정됩니다."],
    effective: ["상승 추세가 강하고 눌림이 짧은 장", "테마·실적·수급 등 상승 촉매가 계속 유입되는 종목", "거래량이 유지되며 단기 이동평균 위에서 움직이는 종목"],
    caution: ["횡보장에서는 잦은 매수·매도 신호로 손실이 누적될 수 있습니다.", "급등 후 장대음봉이 나오면 모멘텀 지표가 늦게 꺾일 수 있습니다.", "진입 기준이 너무 낮으면 노이즈를 추세로 오인합니다."],
    tip: "자동 청산의 트레일링 스탑과 조합하면 강한 추세는 열어두고 급격한 되돌림은 제한하기 쉽습니다.",
  },
  bollinger_selection: {
    core: "볼린저밴드 하단 이탈 또는 근접 종목 중 과도하게 눌린 후보를 찾아 평균회귀 반등 가능성을 보는 종목 선정 전략입니다.",
    logic: ["period 이동평균과 표준편차로 상·하단 밴드를 계산합니다.", "가격이 하단 밴드에 touchThreshold 이내로 접근하거나 이탈하면 후보 점수를 부여합니다.", "밴드 대비 이격이 클수록 단기 과매도 후보로 간주합니다."],
    effective: ["대형주·우량주처럼 평균회귀 성향이 강한 종목", "급락 후 악재가 추가 확산되지 않고 거래가 안정되는 구간", "시장 지수가 박스권이며 과매도 반등이 반복될 때"],
    caution: ["강한 하락 추세에서는 하단 밴드 이탈이 반등 신호가 아니라 추세 가속일 수 있습니다.", "거래정지·관리종목·유동성 부족 종목에는 부적합합니다.", "하락 재료가 해소되지 않은 종목은 물타기 위험이 큽니다."],
    tip: "후보 선정 후 RSI 또는 스토캐스틱 반전 신호와 함께 쓰면 단순 낙폭과대 필터보다 안전합니다.",
  },
  bollinger_trading: {
    core: "가격이 볼린저밴드 하단을 이탈하면 과매도 반등을 기대해 매수하고, 상단에 접근하면 과열로 보고 매도하는 평균회귀 매매 전략입니다.",
    logic: ["period 이동평균과 stdDev 표준편차 배수로 밴드를 만듭니다.", "종가가 하단 밴드 아래면 BUY, 상단 밴드 위면 SELL을 냅니다.", "밴드에서 멀어질수록 신호 강도가 커집니다."],
    effective: ["횡보·박스권 시장", "실적과 수급이 안정적인 대형주", "급락 후 거래량이 감소하며 매도 압력이 둔화되는 구간"],
    caution: ["추세 하락 종목에서는 계속 하단 밴드를 타고 내려갈 수 있습니다.", "상승 추세장에서는 상단 돌파가 매도보다 추세 지속 신호일 수 있습니다.", "표준편차 배수가 낮으면 신호가 과도하게 많아집니다."],
    tip: "시장 추세가 약할 때는 손절을 짧게 두고, 강한 상승장에서는 상단 매도 신호를 보수적으로 해석하는 편이 좋습니다.",
  },
  rsi_selection: {
    core: "RSI가 과매도 구간에 진입한 종목을 반등 후보로 추려내는 역추세형 종목 선정 전략입니다.",
    logic: ["period 기준 RSI를 계산합니다.", "최근 lookback 기간 안에 RSI가 oversoldLevel 아래로 내려간 종목을 후보로 둡니다.", "RSI가 더 낮을수록 과매도 점수를 높게 부여합니다."],
    effective: ["시장 급락 후 기술적 반등이 자주 나오는 구간", "기초 체력이 있는 종목이 단기 수급으로 과매도된 경우", "지수는 안정되는데 개별 종목만 과하게 눌린 상황"],
    caution: ["실적 훼손·악재성 하락은 RSI 과매도만으로 반등하기 어렵습니다.", "하락 추세 초입에서는 과매도 상태가 오래 지속될 수 있습니다.", "거래량이 급감한 종목은 반등 탄력이 약할 수 있습니다."],
    tip: "RSI 후보는 바로 추격하기보다 양봉 전환, 거래량 회복, 지지선 확인을 함께 보는 것이 좋습니다.",
  },
  rsi_trading: {
    core: "RSI가 oversoldLevel 아래면 과매도 반등 매수, overboughtLevel 위면 과열 매도 신호를 내는 대표적인 역추세 실행 전략입니다.",
    logic: ["period 기준 RSI를 계산해 최근 상승폭과 하락폭의 균형을 봅니다.", "RSI가 과매도 구간이면 BUY, 과매수 구간이면 SELL을 반환합니다.", "기준선에서 멀어질수록 신호 강도가 커집니다."],
    effective: ["뚜렷한 박스권에서 상·하단 왕복이 반복될 때", "낙폭과대 후 단기 반등을 노리는 짧은 매매", "변동성은 있지만 장기 추세가 훼손되지 않은 종목"],
    caution: ["강한 추세장에서는 RSI가 과매수/과매도에 오래 머뭅니다.", "과매수 매도 신호가 상승 추세의 조기 이탈로 이어질 수 있습니다.", "단독 사용 시 바닥 확인이 늦거나 너무 빠를 수 있습니다."],
    tip: "RSI는 추세 필터와 함께 쓰는 것이 좋습니다. 예를 들어 장기 이동평균 위에서는 매수 신호만 채택하는 식입니다.",
  },
  golden_cross_selection: {
    core: "단기 이동평균이 장기 이동평균을 상향 돌파한 종목을 찾아 추세 전환 후보로 선정합니다.",
    logic: ["shortPeriod와 longPeriod 이동평균을 계산합니다.", "최근 crossDays 안에 단기선이 장기선을 상향 돌파했는지 확인합니다.", "돌파 직후이면서 가격이 이동평균 위에 있을수록 우선순위를 높입니다."],
    effective: ["하락·횡보 후 거래량이 붙으며 추세 전환이 시작되는 구간", "시장 주도 섹터가 바뀌는 초입", "중기 이동평균이 평탄하거나 우상향으로 돌아서는 종목"],
    caution: ["횡보장에서는 잦은 골든·데드크로스로 속임수가 많습니다.", "이미 급등한 뒤의 골든크로스는 후행 신호일 수 있습니다.", "장기선이 계속 하락 중이면 반등 실패 가능성이 큽니다."],
    tip: "거래량 증가와 함께 발생한 골든크로스를 우선하고, longPeriod를 늘리면 신호는 줄지만 안정성은 높아집니다.",
  },
  golden_cross_trading: {
    core: "단기 이동평균이 장기 이동평균을 상향 돌파하면 매수, 하향 이탈하면 매도하는 추세추종 매매 전략입니다.",
    logic: ["shortPeriod·longPeriod 이동평균의 현재 위치와 직전 위치를 비교합니다.", "상향 교차는 BUY, 하향 교차는 SELL로 판단합니다.", "두 이동평균 간 이격과 교차 방향으로 신호 강도를 계산합니다."],
    effective: ["방향성이 분명한 중기 추세장", "변동성보다 추세 지속성이 큰 종목", "자동매매에서 잦은 단기 신호보다 안정적인 진입·청산을 선호할 때"],
    caution: ["박스권에서는 손실성 왕복매매가 발생하기 쉽습니다.", "이동평균은 후행 지표라 급락에는 늦게 반응합니다.", "짧은 기간 조합은 민감하지만 노이즈가 많고, 긴 기간 조합은 안정적이지만 늦습니다."],
    tip: "골든크로스 매수 후 트레일링 스탑을 켜두면 추세 수익을 보존하면서 데드크로스 전 급락을 방어할 수 있습니다.",
  },
  week52_high_selection: {
    core: "52주 최고가를 갱신하거나 근접한 종목을 강한 상대강도 후보로 선정하는 신고가 돌파형 전략입니다.",
    logic: ["최근 52주 고가와 현재가의 거리를 계산합니다.", "nearHighPct 이내로 접근하거나 돌파한 종목을 후보로 둡니다.", "평균 대비 거래량 배수 minVolMultiplier를 함께 확인해 돌파 신뢰도를 높입니다."],
    effective: ["강한 상승장 또는 주도주 장세", "실적·정책·수급 등 명확한 모멘텀으로 신고가가 나오는 종목", "거래대금이 커지고 기관/외국인 수급이 동반되는 돌파"],
    caution: ["거래량 없는 신고가는 실패 돌파가 될 수 있습니다.", "시장 과열 후반에는 신고가 추격 리스크가 커집니다.", "상장 초기·데이터 부족 종목은 52주 기준 해석이 왜곡될 수 있습니다."],
    tip: "후보 수가 많을 때는 거래대금 순위와 프로그램/외국인 수급을 함께 보며 진짜 주도주만 남기는 것이 좋습니다.",
  },
  week52_high_trading: {
    core: "52주 최고가 돌파를 매수 신호로 보고, 돌파 후 일정 비율 이상 되밀리면 매도하는 돌파매매 실행 전략입니다.",
    logic: ["최근 52주 고가 대비 현재가 위치를 계산합니다.", "최고가 돌파 또는 근접 조건이 충족되면 BUY를 반환합니다.", "돌파 이후 exitDropPct 이상 하락하면 실패 돌파로 보고 SELL을 반환합니다."],
    effective: ["시장 주도주가 신고가를 이어가는 강한 추세장", "돌파 당일 거래량·거래대금이 급증하는 경우", "상단 매물 부담이 적고 뉴스/실적 모멘텀이 남아 있는 종목"],
    caution: ["장중 급등 추격 시 윗꼬리와 갭 메우기에 취약합니다.", "약세장에서는 신고가 돌파 종목 수가 적고 실패율이 높습니다.", "exitDropPct가 너무 넓으면 실패 돌파 손실이 커집니다."],
    tip: "진입 금액을 작게 시작하고 돌파 유지 여부를 확인하는 방식이 적합합니다. 트레일링 스탑과 궁합이 좋습니다.",
  },
  macd_selection: {
    core: "MACD 선이 시그널 선을 상향 돌파하거나 히스토그램이 개선되는 종목을 추세 전환 후보로 선정합니다.",
    logic: ["fast EMA와 slow EMA 차이로 MACD를 만들고 signal EMA를 계산합니다.", "MACD가 시그널을 상향 돌파하고 histogram이 minHistogram 이상이면 후보로 둡니다.", "히스토그램이 음수에서 양수로 전환될수록 전환 신뢰도를 높게 봅니다."],
    effective: ["하락 둔화 후 중기 추세가 회복되는 초입", "거래량이 같이 증가하며 이동평균 구조가 개선될 때", "RSI 과매도 해소와 함께 MACD가 상향 전환하는 경우"],
    caution: ["급등 후에는 MACD가 늦게 따라와 후행 진입이 될 수 있습니다.", "횡보장에서는 작은 크로스가 반복돼 속임수가 많습니다.", "slow 기간이 긴 만큼 초단타보다 스윙 관점에 가깝습니다."],
    tip: "minHistogram을 높이면 후보는 줄지만 약한 크로스를 거를 수 있습니다.",
  },
  macd_trading: {
    core: "MACD 골든크로스에서 매수하고 데드크로스에서 매도하는 중기 추세 전환형 실행 전략입니다.",
    logic: ["fast·slow EMA로 MACD를 계산하고 signal EMA와 비교합니다.", "MACD가 signal 위로 교차하면 BUY, 아래로 교차하면 SELL입니다.", "MACD와 signal의 차이가 커질수록 신호 강도가 커집니다."],
    effective: ["단기 노이즈보다 며칠~수주 단위 추세를 따를 때", "하락 추세가 마무리되고 저점이 높아지는 종목", "거래량이 붙으며 히스토그램이 양수로 확대되는 구간"],
    caution: ["변동성 큰 박스권에서는 잦은 크로스로 손실이 날 수 있습니다.", "급락에는 늦게 반응하므로 별도 손절 가드가 필요합니다.", "초단기 매매에는 반응 속도가 느릴 수 있습니다."],
    tip: "기본 12-26-9 조합은 무난합니다. 빠른 신호가 필요하면 fast/slow를 줄이되 노이즈 증가를 감안해야 합니다.",
  },
  stochastic_selection: {
    core: "스토캐스틱 %K가 과매도 구간에서 %D를 상향 돌파하는 종목을 단기 반등 후보로 선정합니다.",
    logic: ["kPeriod 동안 고가·저가 범위에서 현재 종가 위치를 %K로 계산합니다.", "dPeriod 평균인 %D를 만들고 과매도 구간의 상향 교차를 찾습니다.", "oversoldLevel 아래에서 반전할수록 후보 점수를 높입니다."],
    effective: ["단기 낙폭과대 후 빠른 반등이 자주 나오는 시장", "박스권 하단에서 지지가 확인되는 종목", "RSI와 함께 과매도 해소가 동시에 나타날 때"],
    caution: ["강한 하락 추세에서는 과매도 반전이 여러 번 실패할 수 있습니다.", "지표가 민감해 장중 변동성에 흔들리기 쉽습니다.", "유동성이 낮은 종목은 고가·저가 범위가 왜곡될 수 있습니다."],
    tip: "스토캐스틱 후보는 단기 매매에 적합하므로 익절·손절 기준을 명확히 두는 편이 좋습니다.",
  },
  stochastic_trading: {
    core: "스토캐스틱 과매도 구간의 상향 반전을 매수, 과매수 구간의 하향 반전을 매도로 보는 민감한 단기 역추세 전략입니다.",
    logic: ["%K와 %D를 계산해 최근 가격이 고저 범위 어디에 있는지 봅니다.", "oversoldLevel 아래에서 %K가 %D를 상향 돌파하면 BUY입니다.", "overboughtLevel 위에서 %K가 %D를 하향 이탈하면 SELL입니다."],
    effective: ["박스권·단기 스윙 장세", "지지/저항이 명확하고 왕복 변동이 반복되는 종목", "빠른 진입·청산을 선호하고 자동 청산 가드가 켜져 있을 때"],
    caution: ["추세장에서는 너무 빨리 매도하거나 너무 일찍 매수할 수 있습니다.", "짧은 kPeriod는 신호가 많지만 거짓 신호도 많습니다.", "급락 뉴스가 있는 종목에는 반전 신호 신뢰도가 낮습니다."],
    tip: "신호가 과도하면 kPeriod나 dPeriod를 늘리고, 과매수/과매도 기준을 80/20보다 보수적으로 조정해 보세요.",
  },
  triangle_reversion_trading: {
    core: "삼각수렴이 뚜렷하게 진행된 뒤 위·아래 어느 쪽으로든 이탈하고, 가격이 다시 수렴의 중단부로 돌아오면 이탈 방향의 반대 신호를 내는 단기 회귀 매매입니다.",
    logic: ["최근 patternBars개의 고점은 낮아지고 저점은 높아지는지 선형회귀로 확인합니다.", "직전 봉이 수렴 상단 또는 하단을 breakoutPct 이상 이탈했는지 판단합니다.", "현재가가 수렴 중단부 midpoint에 returnTolerancePct 이내로 돌아오면 하방 이탈 후 회귀는 BUY, 상방 이탈 후 회귀는 SELL을 반환합니다.", "손절 기준은 이탈 봉의 저점/고점에 stopBufferPct를 더해 짧게 잡도록 reason과 indicators에 노출합니다."],
    effective: ["15분·1시간·4시간처럼 수렴 모양이 선명한 구간", "추세 추격보다 이탈 후 되돌림을 짧게 노리는 장", "자동 청산의 손절·트레일링이 켜져 있어 실패 회귀를 빠르게 제한할 수 있을 때"],
    caution: ["현재 시스템의 SELL은 공매도 진입이 아니라 보유분 청산 신호로 동작합니다.", "이탈 후 거래량이 폭증하며 추세가 계속되는 경우 중단부 회귀가 나오지 않거나 회귀 후 재이탈할 수 있습니다.", "일봉 기준 데이터만 넣으면 사용자가 말한 15분·1시간 삼수보다 신호가 늦고 거칠 수 있습니다."],
    tip: "삼수 매매는 손절폭이 짧아야 의미가 있습니다. stopBufferPct를 작게 두고, 자동매매 손절/트레일링 가드와 함께 쓰는 편이 좋습니다.",
  },
};

export default function StrategyPanel() {
  const [expandedStrategy, setExpandedStrategy] = useState<string | null>(null);
  const [openedGuideStrategy, setOpenedGuideStrategy] = useState<string | null>(null);
  const [editingParams, setEditingParams] = useState<Record<string, Record<string, number | string | boolean>>>({});

  const utils = trpc.useUtils();
  const { data: allMeta = [] } = trpc.strategy.getAllMeta.useQuery();
  const { data: userConfigs = [] } = trpc.strategy.getUserConfigs.useQuery();
  const { data: autoConfig } = trpc.autoTrader.getConfig.useQuery();
  const { data: kisSettings } = trpc.kis.getSettings.useQuery();
  const { data: accounts = [] } = trpc.kis.listAccounts.useQuery();

  const initMutation = trpc.strategy.initDefaults.useMutation({
    onSuccess: () => utils.strategy.getUserConfigs.invalidate(),
  });
  const saveMutation = trpc.strategy.saveConfig.useMutation({
    onSuccess: () => { utils.strategy.getUserConfigs.invalidate(); toast.success("전략 설정 저장됨"); },
    onError: (e) => toast.error(e.message),
  });
  const saveAutoMutation = trpc.autoTrader.saveConfig.useMutation({
    onSuccess: () => { utils.autoTrader.getConfig.invalidate(); toast.success("자동매매 설정 저장됨"); },
    onError: (e) => toast.error(e.message),
  });
  const toggleRunMutation = trpc.autoTrader.toggleRunning.useMutation({
    onSuccess: () => utils.autoTrader.getConfig.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (userConfigs.length === 0) initMutation.mutate();
  }, [userConfigs.length]);

  const selectionMeta = allMeta.filter((m) => m.type === "selection");
  const tradingMeta = allMeta.filter((m) => m.type === "trading");

  const getConfig = (strategyId: string) => userConfigs.find((c) => c.strategyId === strategyId);

  const handleToggle = (strategyId: string, strategyType: "selection" | "trading", isEnabled: boolean) => {
    const config = getConfig(strategyId);
    const meta = allMeta.find((m) => m.id === strategyId);
    if (!meta) return;
    saveMutation.mutate({
      id: config?.id,
      strategyType,
      strategyId,
      strategyName: meta.name,
      isEnabled,
      params: (editingParams[strategyId] || config?.params || meta.defaultParams) as Record<string, number | string | boolean>,
    });
  };

  const handleSaveParams = (strategyId: string, strategyType: "selection" | "trading") => {
    const config = getConfig(strategyId);
    const meta = allMeta.find((m) => m.id === strategyId);
    if (!meta) return;
    saveMutation.mutate({
      id: config?.id,
      strategyType,
      strategyId,
      strategyName: meta.name,
      isEnabled: config?.isEnabled || false,
      params: editingParams[strategyId] as Record<string, number | string | boolean>,
    });
    setExpandedStrategy(null);
  };

  const getParamValue = (strategyId: string, key: string, defaultVal: number | string | boolean) => {
    if (editingParams[strategyId]?.[key] !== undefined) return editingParams[strategyId][key];
    const config = getConfig(strategyId);
    if (config?.params && (config.params as Record<string, unknown>)[key] !== undefined) {
      return (config.params as Record<string, unknown>)[key] as number | string | boolean;
    }
    return defaultVal;
  };

  const setParamValue = (strategyId: string, key: string, value: number | string | boolean) => {
    setEditingParams((prev) => ({
      ...prev,
      [strategyId]: { ...(prev[strategyId] || {}), [key]: value },
    }));
  };

  const enabledSelectionConfigs = userConfigs.filter((c) => c.strategyType === "selection" && c.isEnabled);
  const enabledTradingConfigs = userConfigs.filter((c) => c.strategyType === "trading" && c.isEnabled);

  const buildAutoConfigPayload = (overrides: Partial<{
    selectionStrategyId: number | null;
    tradingStrategyId: number | null;
    maxPositions: number;
    maxOrderAmount: number;
    entryCashPct: number;
    riskPerTradePct: number;
    maxPortfolioExposurePct: number;
    stopLossPct: number;
    takeProfitPct: number;
    trailingStopPct: number;
    partialTakeProfitPct: number;
    partialTakeProfitSellPct: number;
    breakEvenTriggerPct: number;
    breakEvenBufferPct: number;
    accountProfileId: number | null;
  }> = {}) => ({
    selectionStrategyId: autoConfig?.selectionStrategyId ?? null,
    tradingStrategyId: autoConfig?.tradingStrategyId ?? null,
    maxPositions: autoConfig?.maxPositions || 5,
    maxOrderAmount: Number(autoConfig?.maxOrderAmount) || 1_000_000,
    entryCashPct: Number(autoConfig?.entryCashPct) || 10,
    riskPerTradePct: Number(autoConfig?.riskPerTradePct) || 1,
    maxPortfolioExposurePct: Number(autoConfig?.maxPortfolioExposurePct) || 50,
    stopLossPct: Number(autoConfig?.stopLossPct) || 3,
    takeProfitPct: Number(autoConfig?.takeProfitPct) || 5,
    trailingStopPct: Number(autoConfig?.trailingStopPct) || 0,
    partialTakeProfitPct: Number(autoConfig?.partialTakeProfitPct) || 0,
    partialTakeProfitSellPct: Number(autoConfig?.partialTakeProfitSellPct) || 50,
    breakEvenTriggerPct: Number(autoConfig?.breakEvenTriggerPct) || 0,
    breakEvenBufferPct: Number(autoConfig?.breakEvenBufferPct) || 0,
    accountProfileId: autoConfig?.accountProfileId ?? null,
    ...overrides,
  });

  const saveAutoConfig = (overrides: Parameters<typeof buildAutoConfigPayload>[0]) => {
    saveAutoMutation.mutate(buildAutoConfigPayload(overrides));
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Auto Trading Control */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Zap size={12} className={autoConfig?.isRunning ? "text-bull animate-pulse-green" : "text-muted-foreground"} />
            <span className="text-xs font-semibold">자동매매</span>
            {autoConfig?.isRunning && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bull/20 text-bull">실행 중</span>
            )}
          </div>
          <button
            onClick={() => toggleRunMutation.mutate({ isRunning: !autoConfig?.isRunning })}
            disabled={toggleRunMutation.isPending || !kisSettings?.isActive}
            className={`flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors disabled:opacity-40 ${
              autoConfig?.isRunning
                ? "bg-bear/20 text-bear border border-bear hover:bg-bear/30"
                : "bg-bull/20 text-bull border border-bull hover:bg-bull/30"
            }`}
          >
            {autoConfig?.isRunning ? <><Square size={10} />중지</> : <><Play size={10} />시작</>}
          </button>
        </div>
        {!kisSettings?.isActive && (
          <p className="text-[10px] text-bear">⚠️ KIS API 연결 후 자동매매 사용 가능</p>
        )}

        {/* Account Assignment */}
        {accounts.length > 1 && (
          <div className="mt-2">
            <div className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1 mb-1">
              <CreditCard size={10} />
              자동매매 계좌 배정
            </div>
            <select
              value={autoConfig?.accountProfileId || ""}
              onChange={(e) => saveAutoConfig({
                accountProfileId: e.target.value ? parseInt(e.target.value) : null,
              })}
              className="w-full text-xs bg-secondary border border-border rounded px-2 py-1 text-foreground"
            >
              <option value="">-- 활성 계좌 사용 (기본값) --</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.profileName} ({acc.accountNo}-{acc.accountProduct}) [{acc.mode === 'paper' ? '모의' : '실전'}]
                </option>
              ))}
            </select>
            {autoConfig?.accountProfileId && (
              <p className="text-[9px] text-primary mt-0.5">
                ✓ 지정 계좌로 자동매매 실행됩니다
              </p>
            )}
          </div>
        )}

        {/* Strategy Combination Selector */}
        <div className="mt-2 space-y-1.5">
          <div className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1">
            <Link2 size={10} />
            전략 조합 설정
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">종목 선정 전략</label>
            <select
              value={autoConfig?.selectionStrategyId || ""}
              onChange={(e) => saveAutoConfig({
                selectionStrategyId: e.target.value ? parseInt(e.target.value) : null,
              })}
              className="w-full text-xs mt-0.5 bg-secondary border border-border rounded px-2 py-1 text-foreground"
            >
              <option value="">-- 선택 안함 (전체 관심종목) --</option>
              {selectionMeta.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">매매 실행 전략</label>
            <select
              value={autoConfig?.tradingStrategyId || ""}
              onChange={(e) => saveAutoConfig({
                tradingStrategyId: e.target.value ? parseInt(e.target.value) : null,
              })}
              className="w-full text-xs mt-0.5 bg-secondary border border-border rounded px-2 py-1 text-foreground"
            >
              <option value="">-- 선택 안함 --</option>
              {tradingMeta.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Auto Trader Config */}
        <div className="space-y-2 mt-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">최대 포지션</label>
              <input
                type="number"
                defaultValue={autoConfig?.maxPositions || 5}
                min={1} max={20}
                onBlur={(e) => saveAutoConfig({
                  maxPositions: parseInt(e.target.value) || 5,
                })}
                className="w-full text-xs mt-0.5"
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">최대 주문금액</label>
              <input
                type="number"
                defaultValue={Number(autoConfig?.maxOrderAmount) || 1_000_000}
                step={100000}
                onBlur={(e) => saveAutoConfig({
                  maxOrderAmount: parseInt(e.target.value) || 1_000_000,
                })}
                className="w-full text-xs mt-0.5"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">손절 (%)</label>
              <input
                type="number"
                defaultValue={Number(autoConfig?.stopLossPct) || 3}
                min={0} max={50} step={0.5}
                onBlur={(e) => saveAutoConfig({
                  stopLossPct: Math.max(0, parseFloat(e.target.value) || 0),
                })}
                className="w-full text-xs mt-0.5"
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">익절 (%)</label>
              <input
                type="number"
                defaultValue={Number(autoConfig?.takeProfitPct) || 5}
                min={0} max={100} step={0.5}
                onBlur={(e) => saveAutoConfig({
                  takeProfitPct: Math.max(0, parseFloat(e.target.value) || 0),
                })}
                className="w-full text-xs mt-0.5"
              />
            </div>
          </div>

          <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-300">
                <TrendingDown size={11} />
                트레일링·부분청산
              </div>
              <span className="text-[9px] text-muted-foreground">Exit guard</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <label className="text-[9px] text-muted-foreground">트레일링</label>
                <input
                  type="number"
                  defaultValue={Number(autoConfig?.trailingStopPct) || 0}
                  min={0} max={50} step={0.5}
                  onBlur={(e) => saveAutoConfig({
                    trailingStopPct: Math.max(0, parseFloat(e.target.value) || 0),
                  })}
                  className="w-full text-xs mt-0.5"
                />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">부분익절</label>
                <input
                  type="number"
                  defaultValue={Number(autoConfig?.partialTakeProfitPct) || 0}
                  min={0} max={100} step={0.5}
                  onBlur={(e) => saveAutoConfig({
                    partialTakeProfitPct: Math.max(0, parseFloat(e.target.value) || 0),
                  })}
                  className="w-full text-xs mt-0.5"
                />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">매도비중</label>
                <input
                  type="number"
                  defaultValue={Number(autoConfig?.partialTakeProfitSellPct) || 50}
                  min={1} max={100} step={5}
                  onBlur={(e) => saveAutoConfig({
                    partialTakeProfitSellPct: Math.min(100, Math.max(1, parseFloat(e.target.value) || 50)),
                  })}
                  className="w-full text-xs mt-0.5"
                />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">본전발동</label>
                <input
                  type="number"
                  defaultValue={Number(autoConfig?.breakEvenTriggerPct) || 0}
                  min={0} max={100} step={0.5}
                  onBlur={(e) => saveAutoConfig({
                    breakEvenTriggerPct: Math.max(0, parseFloat(e.target.value) || 0),
                  })}
                  className="w-full text-xs mt-0.5"
                />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">본전버퍼</label>
                <input
                  type="number"
                  defaultValue={Number(autoConfig?.breakEvenBufferPct) || 0}
                  min={0} max={20} step={0.25}
                  onBlur={(e) => saveAutoConfig({
                    breakEvenBufferPct: Math.max(0, parseFloat(e.target.value) || 0),
                  })}
                  className="w-full text-xs mt-0.5"
                />
              </div>
            </div>
            <p className="text-[9px] leading-relaxed text-muted-foreground">
              트레일링은 보유 중 최고가 대비 하락률로 전량 청산합니다. 부분익절은 종목별 1회만 설정 비중만큼 매도하고, 본전 스탑은 지정 수익률 도달 후 평단가+버퍼까지 되밀리면 방어 청산합니다.
            </p>
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/5 p-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-primary">
                <ShieldAlert size={11} />
                자금관리 가드레일
              </div>
              <span className="text-[9px] text-muted-foreground">Fixed fractional</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <label className="text-[9px] text-muted-foreground">진입 비중</label>
                <input
                  type="number"
                  defaultValue={Number(autoConfig?.entryCashPct) || 10}
                  min={1} max={100} step={1}
                  onBlur={(e) => saveAutoConfig({
                    entryCashPct: parseFloat(e.target.value) || 10,
                  })}
                  className="w-full text-xs mt-0.5"
                />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">거래당 위험</label>
                <input
                  type="number"
                  defaultValue={Number(autoConfig?.riskPerTradePct) || 1}
                  min={0} max={10} step={0.25}
                  onBlur={(e) => saveAutoConfig({
                    riskPerTradePct: parseFloat(e.target.value) || 1,
                  })}
                  className="w-full text-xs mt-0.5"
                />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">총 노출 한도</label>
                <input
                  type="number"
                  defaultValue={Number(autoConfig?.maxPortfolioExposurePct) || 50}
                  min={1} max={100} step={1}
                  onBlur={(e) => saveAutoConfig({
                    maxPortfolioExposurePct: parseFloat(e.target.value) || 50,
                  })}
                  className="w-full text-xs mt-0.5"
                />
              </div>
            </div>
            <p className="text-[9px] leading-relaxed text-muted-foreground">
              신규 진입금액은 주문금액, 평가금 대비 진입 비중, 손절폭 기준 거래당 위험, 총 노출 한도 중 가장 작은 값으로 제한합니다. 시장가 체결·갭 하락 손실을 보장하지는 않습니다.
            </p>
          </div>
        </div>

        {/* Stop-loss / Take-profit Status */}
        {(Number(autoConfig?.stopLossPct) > 0 || Number(autoConfig?.takeProfitPct) > 0 || Number(autoConfig?.trailingStopPct) > 0 || Number(autoConfig?.partialTakeProfitPct) > 0 || Number(autoConfig?.breakEvenTriggerPct) > 0) && (
          <div className="mt-2 p-2 rounded bg-secondary/40 border border-border/50">
            <div className="flex items-center gap-1.5 mb-1.5">
              <ShieldAlert size={11} className="text-yellow-400" />
              <span className="text-[10px] font-semibold text-yellow-400">자동 청산 활성</span>
            </div>
            <div className="flex flex-wrap gap-3 text-[10px]">
              {Number(autoConfig?.stopLossPct) > 0 && (
                <div className="flex items-center gap-1">
                  <TrendingDown size={10} className="text-bear" />
                  <span className="text-muted-foreground">손절:</span>
                  <span className="text-bear font-mono font-bold">-{autoConfig?.stopLossPct}%</span>
                </div>
              )}
              {Number(autoConfig?.takeProfitPct) > 0 && (
                <div className="flex items-center gap-1">
                  <TrendingUp size={10} className="text-bull" />
                  <span className="text-muted-foreground">익절:</span>
                  <span className="text-bull font-mono font-bold">+{autoConfig?.takeProfitPct}%</span>
                </div>
              )}
              {Number(autoConfig?.trailingStopPct) > 0 && (
                <div className="flex items-center gap-1">
                  <TrendingDown size={10} className="text-amber-300" />
                  <span className="text-muted-foreground">트레일링:</span>
                  <span className="text-amber-300 font-mono font-bold">-{autoConfig?.trailingStopPct}%</span>
                </div>
              )}
              {Number(autoConfig?.partialTakeProfitPct) > 0 && (
                <div className="flex items-center gap-1">
                  <TrendingUp size={10} className="text-bull" />
                  <span className="text-muted-foreground">부분익절:</span>
                  <span className="text-bull font-mono font-bold">+{autoConfig?.partialTakeProfitPct}%/{autoConfig?.partialTakeProfitSellPct}%</span>
                </div>
              )}
              {Number(autoConfig?.breakEvenTriggerPct) > 0 && (
                <div className="flex items-center gap-1">
                  <ShieldAlert size={10} className="text-primary" />
                  <span className="text-muted-foreground">본전스탑:</span>
                  <span className="text-primary font-mono font-bold">+{autoConfig?.breakEvenTriggerPct}% 후 +{autoConfig?.breakEvenBufferPct}%</span>
                </div>
              )}
            </div>
            <p className="text-[9px] text-muted-foreground mt-1">
              자동매매 사이클마다 보유 종목 전체를 스캔하여 손절·익절·트레일링·부분익절·본전 스탑 조건을 시장가 청산으로 실행합니다.
            </p>
          </div>
        )}
      </div>

      {/* Strategy Sections */}
      {[
        { title: "종목 선정 전략", icon: Target, type: "selection" as const, metas: selectionMeta },
        { title: "매매 실행 전략", icon: Zap, type: "trading" as const, metas: tradingMeta },
      ].map(({ title, icon: Icon, type, metas }) => (
        <div key={type} className="border-b border-border">
          <div className="panel-header">
            <div className="flex items-center gap-1.5">
              <Icon size={12} />
              <span>{title}</span>
            </div>
          </div>
          <div className="divide-y divide-border/50">
            {metas.map((meta) => {
              const config = getConfig(meta.id);
              const isEnabled = config?.isEnabled || false;
              const isExpanded = expandedStrategy === meta.id;
              const guide = strategyGuides[meta.id];
              const isGuideOpen = openedGuideStrategy === meta.id;

              return (
                <div key={meta.id}>
                  <div className="flex items-center px-3 py-2 gap-2">
                    <button
                      onClick={() => setExpandedStrategy(isExpanded ? null : meta.id)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{meta.name}</div>
                    </div>
                    {guide && (
                      <button
                        type="button"
                        aria-label={`${meta.name} 상세 설명 보기`}
                        title={`${meta.name} 상세 설명`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenedGuideStrategy(isGuideOpen ? null : meta.id);
                        }}
                        className={`shrink-0 rounded-full border p-1 transition-colors ${
                          isGuideOpen
                            ? "border-primary/70 bg-primary/20 text-primary"
                            : "border-border/70 bg-secondary/40 text-muted-foreground hover:text-foreground hover:bg-secondary"
                        }`}
                      >
                        <Info size={11} />
                      </button>
                    )}
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(e) => handleToggle(meta.id, type, e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-8 h-4 bg-secondary peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-muted-foreground after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary/30 peer-checked:after:bg-primary"></div>
                    </label>
                  </div>

                  {guide && isGuideOpen && (
                    <div className="strategy-guide-popover mx-3 mb-2 rounded-lg border border-primary/25 bg-background/95 p-3 shadow-lg space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-foreground">{meta.name}</div>
                          <div className="text-[10px] text-primary mt-0.5">상세 전략 설명</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setOpenedGuideStrategy(null)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                        >
                          닫기
                        </button>
                      </div>
                      <div className="space-y-1.5 text-[10px] leading-relaxed">
                        <div>
                          <div className="font-semibold text-primary mb-0.5">핵심 원리</div>
                          <p className="text-muted-foreground">{guide.core}</p>
                        </div>
                        <div>
                          <div className="font-semibold text-foreground mb-0.5">판단 로직</div>
                          <ul className="space-y-0.5 text-muted-foreground list-disc pl-4">
                            {guide.logic.map((item) => <li key={item}>{item}</li>)}
                          </ul>
                        </div>
                        <div>
                          <div className="font-semibold text-bull mb-0.5">효과 좋은 조건</div>
                          <ul className="space-y-0.5 text-muted-foreground list-disc pl-4">
                            {guide.effective.map((item) => <li key={item}>{item}</li>)}
                          </ul>
                        </div>
                        <div>
                          <div className="font-semibold text-amber-300 mb-0.5">주의할 조건</div>
                          <ul className="space-y-0.5 text-muted-foreground list-disc pl-4">
                            {guide.caution.map((item) => <li key={item}>{item}</li>)}
                          </ul>
                        </div>
                        <div className="rounded border border-border/60 bg-secondary/40 p-2">
                          <span className="font-semibold text-foreground">운영 팁: </span>
                          <span className="text-muted-foreground">{guide.tip}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Expanded params */}
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2 bg-secondary/30">
                      {/* Description */}
                      <div className="flex gap-1 text-[10px] text-muted-foreground">
                        <Info size={10} className="mt-0.5 shrink-0" />
                        <span>{meta.description}</span>
                      </div>
                      {meta.reference && (
                        <div className="text-[10px] text-primary/70 italic">{meta.reference}</div>
                      )}

                      {/* Parameters */}
                      {meta.paramSchema.map((param) => (
                        <div key={param.key}>
                          <div className="flex justify-between mb-0.5">
                            <label className="text-[10px] text-muted-foreground">{param.label}</label>
                            <span className="text-[10px] font-mono text-foreground">
                              {getParamValue(meta.id, param.key, meta.defaultParams[param.key])}
                            </span>
                          </div>
                          {param.type === "number" ? (
                            <input
                              type="range"
                              min={param.min}
                              max={param.max}
                              step={param.step}
                              value={Number(getParamValue(meta.id, param.key, meta.defaultParams[param.key]))}
                              onChange={(e) => setParamValue(meta.id, param.key, parseFloat(e.target.value))}
                              className="w-full h-1 accent-primary"
                            />
                          ) : (
                            <input
                              type="checkbox"
                              checked={Boolean(getParamValue(meta.id, param.key, meta.defaultParams[param.key]))}
                              onChange={(e) => setParamValue(meta.id, param.key, e.target.checked)}
                            />
                          )}
                        </div>
                      ))}

                      <button
                        onClick={() => handleSaveParams(meta.id, type)}
                        className="w-full py-1 bg-primary/20 text-primary text-[10px] rounded hover:bg-primary/30 transition-colors"
                      >
                        파라미터 저장
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Active Strategy Summary */}
      {(enabledSelectionConfigs.length > 0 || enabledTradingConfigs.length > 0) && (
        <div className="p-3 space-y-2">
          <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">활성 전략</div>
          {enabledSelectionConfigs.map((c) => (
            <div key={c.id} className="flex items-center gap-1.5 text-[10px]">
              <Target size={10} className="text-primary" />
              <span className="text-foreground">{c.strategyName}</span>
            </div>
          ))}
          {enabledTradingConfigs.map((c) => (
            <div key={c.id} className="flex items-center gap-1.5 text-[10px]">
              <Zap size={10} className="text-bull" />
              <span className="text-foreground">{c.strategyName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
