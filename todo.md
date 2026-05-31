# KIS Auto Trader - Project TODO

## Phase 2: DB Schema & Setup
- [x] DB 스키마 설계 (kis_settings, watchlist, strategies, orders, auto_trader_log)
- [x] 마이그레이션 SQL 실행
- [x] lightweight-charts, crypto-js 패키지 설치

## Phase 3: Backend
- [x] KIS API 인증 모듈 (토큰 발급, 갱신, 암호화 저장)
- [x] KIS REST API 클라이언트 (시세, 주문, 잔고, 차트 데이터)
- [x] KIS WebSocket 실시간 시세 모듈
- [x] 전략 플러그인 인터페이스 정의 (ISelectionStrategy, ITradingStrategy)
- [x] 전략 5종 구현 (모멘텀, 볼린저밴드, RSI, 골든크로스, 52주신고가)
- [x] 자동매매 스케줄러 (장 시작 전 선정 → 장중 신호 감지 → 주문)
- [x] 텔레그램 알림 모듈
- [x] tRPC 라우터 (kis, watchlist, strategy, order, autoTrader, settings)
- [x] Rate Limit 미들웨어

## Phase 4: Frontend
- [x] 다크 테마 금융 UI CSS 설정
- [x] 원페이지 3패널 레이아웃 (좌: 관심종목, 중: 차트+주문, 우: 전략+잔고)
- [x] lightweight-charts 기반 캔들차트 컴포넌트
- [x] 이동평균선(5/20/60/120), 볼린저밴드, 거래량 지표
- [x] 일/주/월봉 전환 및 확대/축소
- [x] 관심종목 패널 (추가/삭제/정렬, 실시간 현재가)
- [x] 주문 패널 (시장가/지정가, 미체결 조회/취소)
- [x] 잔고 패널 (보유종목, 평가손익)
- [x] 전략 설정 패널 (선정/매매 전략 조합, 파라미터 커스터마이징)
- [x] 자동매매 ON/OFF 토글
- [x] KIS API 설정 모달 (appkey/appsecret, 실전/모의 전환)
- [x] 텔레그램 설정 UI

## Phase 5: Scheduler, Telegram, Security
- [x] 자동매매 Heartbeat 스케줄러 등록
- [x] 텔레그램 봇 알림 구현
- [x] API 키 AES 암호화 저장
- [x] Rate Limit 적용
- [x] Vitest 테스트 작성 (15/15 통과)

## Phase 6: 추가 기능 (2차)
- [x] MACD 보조지표 (차트 패널 + 전략 엔진)
- [x] 스토캐스틱 보조지표 (차트 패널 + 전략 엔진)
- [x] 백테스트 기능 (서버 엔진 + 결과 UI 패널)
- [x] 손절/익절 자동 청산 강화 (보유 종목 실시간 모니터링)

## Phase 7: 3차 추가 기능
- [ ] 종목 스크리너 결과 DB 저장 (screener_results 테이블)
- [ ] '오늘의 선정 종목' UI 패널 (대시보드 통합)
- [ ] 자동매매 사이클에서 선정 종목 저장 연동
- [ ] 백테스트 다중 전략 비교 테이블 (서버 배치 실행)
- [ ] 전략 비교 결과 UI (수익률/MDD/샤프비율 나란히 비교)
- [ ] WebSocket 서버 브릿지 (KIS WS → Socket.IO 릴레이)
- [ ] 프론트엔드 실시간 시세 구독 (관심종목 현재가 1초 갱신)
- [ ] 차트 실시간 틱 업데이트
