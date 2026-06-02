# KIS Auto Trader - Project TODO

## Phase 2: DB Schema & Setup
- [x] DB 스키마 설계 (kis_settings, watchlist, strategies, orders, auto_trader_log)
- [x] 마이그레이션 SQL 실행
- [x] lightweight-charts, crypto-js 패키지 설치

## Phase 3: KIS API Integration
- [x] KIS API 클라이언트 구현
- [x] OAuth 토큰 발급/갱신
- [x] 현재가 조회 API
- [x] 일봉/주봉/월봉 조회 API
- [x] 매수/매도 주문 API
- [x] 계좌 잔고 조회 API
- [x] API 설정 UI

## Phase 4: Trading Strategies
- [x] 전략 인터페이스 정의
- [x] 이동평균선 돌파 전략
- [x] RSI 과매도/과매수 전략
- [x] 볼린저밴드 전략
- [x] MACD 골든크로스 전략
- [x] 거래량 급증 전략
- [x] 전략 파라미터 설정 UI

## Phase 5: Chart UI
- [x] TradingView 스타일 캔들차트
- [x] 이동평균선 표시
- [x] 거래량 차트
- [x] 기간 선택 (일/주/월)
- [x] 크로스헤어 데이터 표시
- [x] 관심종목 연동

## Phase 6: Order System
- [x] 수동 주문 패널
- [x] 시장가/지정가 주문
- [x] 주문 내역 조회
- [x] 미체결 주문 조회
- [x] 주문 취소 기능

## Phase 7: Auto Trading Engine
- [x] 자동매매 엔진 구현
- [x] 스케줄링 (장 시작/종료)
- [x] 리스크 관리 (최대 투자금, 손절/익절)
- [x] 자동매매 로그
- [x] 자동매매 제어 UI

## Phase 8: Backtesting
- [x] 백테스트 엔진 구현
- [x] 성과 지표 계산
- [x] 백테스트 UI
- [x] 결과 차트 표시

## Phase 9: Notifications
- [x] 텔레그램 알림 설정
- [x] 주문 체결 알림
- [x] 매매 신호 알림
- [x] 오류 알림

## Phase 10: Real-time Features
- [x] WebSocket 실시간 시세
- [x] 실시간 차트 업데이트
- [x] 실시간 알림

## Phase 11: 다계좌·호가·성과 고도화
- [x] KIS 다계좌 프로필 관리와 활성 계좌 전환
- [x] 10단계 호가 패널과 주문 패널 연동
- [x] 일별/전략별/종목별 성과 집계 패널
- [x] 테스트·빌드·라이브 런타임 검증

## Phase 12: KIS 신용거래 수동주문
- [x] KIS `order-credit` 엔드포인트와 실전투자 전용 제약 확인
- [x] 현금/신용 주문 구분, 신용유형, 대출일자 주문 계약 테스트 추가
- [x] 주문 API·DB 주문 이력·주문 패널에 신용거래 옵션 연결
- [x] 테스트·타입체크·빌드·DB 컬럼 반영

## Phase 13: 전체종목 기반 자동매매 유니버스
- [x] 전체 KRX 상장종목을 자동매매 선정 후보로 사용
- [x] 저거래량, 거래대금 부족, 관리/주의 상태, 거래정지, 동전주, ETF/ETN, 스팩, 리츠, 우선주 제외조건 적용
- [x] 전략별 현재 매수 조건에 맞는 종목을 스크리너 패널에서 조회
- [x] 테스트·빌드·라이브 런타임 검증

## Phase 14: KIS 순위 API 후보·계좌 잔고 표시
- [x] 전체종목 전략 스캐너 후보 생성을 KIS 거래대금/거래량 순위 API 우선으로 전환
- [x] 순위 API 장애 시 기존 개별 현재가 스캔으로 fallback
- [x] 계좌 잔고 패널에서 예수금, 출금가능, 총평가, 평가손익, 보유종목 표시
- [x] 테스트·빌드·라이브 런타임 검증

## Phase 15: 종목별 프로그램 매매 표시
- [x] KIS 종목별 프로그램매매 체결 API 연동
- [x] 종목 상세/차트 패널에 프로그램 매수·매도·순매수·증감 카드 표시
- [x] KIS 비활성 상태에서는 프로그램 매매 조회를 수행하지 않도록 보호
- [x] 테스트·타입체크·빌드·라이브 런타임 검증
