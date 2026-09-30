const ENGLISH_WORDS = `
apple banana orange grape melon peach pear lemon mango berry cherry kiwi plum coconut pineapple
bread rice noodle pasta pizza burger sandwich soup salad cheese butter milk yogurt egg chicken beef pork fish shrimp
water coffee tea juice soda cocoa sugar salt pepper honey snack cookie cake candy chocolate icecream breakfast lunch dinner
kitchen spoon fork knife plate bowl cup glass bottle pan pot oven fridge table chair kettle toaster recipe meal
home house room door window wall floor roof garden yard balcony stairs lamp clock mirror pillow blanket towel soap brush comb
shirt pants skirt dress coat jacket sweater socks shoes hat bag wallet belt button pocket umbrella glove scarf uniform
school class teacher student book notebook pencil pen eraser ruler paper desk lesson homework test question answer library campus
office work meeting email phone computer screen keyboard mouse printer folder file calendar schedule project report document
market store shop price money card cash receipt basket gift box package order customer sale coupon
car bus train subway taxi bike road street bridge station airport ticket trip travel hotel map suitcase passport
morning noon evening night today tomorrow yesterday weekday weekend week month year time minute hour season holiday
spring summer autumn winter rain snow wind cloud sun sky river lake sea mountain forest tree flower grass leaf stone
dog cat rabbit bird duck horse cow pig sheep turtle hamster puppy kitten pet animal
family parent mother father sister brother baby child friend neighbor guest cousin uncle aunt grandma grandpa
happy sad angry tired sleepy hungry thirsty busy quiet brave kind funny lucky ready calm proud shy worried excited
walk run jump sit stand open close start stop push pull carry hold give take bring send find lose return arrive leave
wash clean cook bake eat drink sleep wake read write draw sing dance smile laugh cry listen watch speak think learn teach
buy sell pay wait help call meet visit drive ride swim play rest study practice remember forget choose change move stay
red blue green yellow black white pink purple brown gray bright dark warm cool hot cold big small long short round square
fast slow new old young good bad soft hard sweet sour fresh dry wet heavy light loud silent easy difficult safe careful
doctor nurse artist driver farmer baker chef police pilot singer actor writer designer engineer dentist barber clerk
music movie photo picture story song game party picnic hobby dream idea news radio camera television concert
body head face hair eye nose mouth ear hand arm leg foot finger tooth neck shoulder knee heart
city village country park beach hospital bank museum theater restaurant cafe bakery pharmacy factory church
bed sofa shelf drawer closet carpet curtain basket bucket key lock bell candle battery charger cable
Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December
hello goodbye please thanks sorry welcome yes no maybe always never often sometimes together alone here there inside outside
color shape number name address birthday weather temperature sound voice language letter word sentence
soccer baseball tennis golf basketball volleyball bowling skating hiking camping fishing running cycling
tomato potato onion carrot cabbage cucumber pumpkin corn bean mushroom garlic lettuce spinach pepper
rose tulip lily daisy sunflower bamboo pine maple oak seed root branch fruit vegetable
trainplane ferry truck van scooter elevator escalator entrance exit corner center front back left right
silver gold copper wood plastic metal cotton wool leather paper rubber
morningtime sunlight moonlight shadow rainbow thunder lightning fog breeze storm
promise secret joke memory chance reason plan goal result mistake success problem solution
cleaner manager owner worker visitor passenger member team group crowd couple
online website message password account profile download upload search click touch
health exercise medicine vitamin fever cough headache stomach toothache bandage
zero one two three four five six seven eight nine ten hundred thousand
`.trim().split(/\s+/).map((word) => word.toLowerCase())

const KOREAN_WORDS = `
사과 바나나 오렌지 포도 수박 복숭아 배 레몬 망고 딸기 체리 키위 자두 코코넛 파인애플
빵 밥 국수 파스타 피자 햄버거 샌드위치 수프 샐러드 치즈 버터 우유 요구르트 달걀 닭고기 소고기 돼지고기 생선 새우
물 커피 차 주스 탄산수 코코아 설탕 소금 후추 꿀 과자 쿠키 케이크 사탕 초콜릿 아이스크림 아침식사 점심식사 저녁식사
부엌 숟가락 포크 칼 접시 그릇 컵 유리병 냄비 프라이팬 오븐 냉장고 식탁 의자 주전자 토스터 조리법 식사
집 방 문 창문 벽 바닥 지붕 정원 마당 발코니 계단 전등 시계 거울 베개 이불 수건 비누 칫솔 빗
셔츠 바지 치마 원피스 외투 재킷 스웨터 양말 신발 모자 가방 지갑 허리띠 단추 주머니 우산 장갑 목도리 교복
학교 교실 선생님 학생 책 공책 연필 펜 지우개 자 종이 책상 수업 숙제 시험 질문 대답 도서관 운동장
사무실 업무 회의 이메일 전화 컴퓨터 화면 키보드 마우스 프린터 폴더 파일 달력 일정 계획 보고서 문서
시장 가게 상점 가격 돈 카드 현금 영수증 바구니 선물 상자 포장 주문 손님 할인 쿠폰
자동차 버스 기차 지하철 택시 자전거 도로 거리 다리 정류장 공항 표 여행 호텔 지도 여행가방 여권
아침 정오 저녁 밤 오늘 내일 어제 평일 주말 일주일 한달 일년 시간 분 초 계절 휴일
봄 여름 가을 겨울 비 눈 바람 구름 해 하늘 강 호수 바다 산 숲 나무 꽃 풀 잎 돌
강아지 고양이 토끼 새 오리 말 소 돼지 양 거북이 햄스터 새끼강아지 새끼고양이 반려동물 동물
가족 부모 엄마 아빠 언니 누나 오빠 형 동생 아기 아이 친구 이웃 손님 사촌 삼촌 이모 할머니 할아버지
행복 슬픔 화남 피곤 졸림 배고픔 목마름 바쁨 조용 용감 친절 재미 행운 준비 차분 자랑 수줍음 걱정 설렘
걷다 뛰다 점프 앉다 서다 열다 닫다 시작 정지 밀다 당기다 들다 잡다 주다 받다 가져오다 보내다 찾다 잃다 돌아오다
씻다 청소 요리 굽다 먹다 마시다 자다 깨다 읽다 쓰다 그리다 노래 춤 미소 웃다 울다 듣다 보다 말하다 생각
배우다 가르치다 사다 팔다 계산 기다리다 돕다 부르다 만나다 방문 운전 타다 수영 놀다 쉬다 공부 연습 기억 잊다
선택 변화 이동 머물다 빨강 파랑 초록 노랑 검정 하양 분홍 보라 갈색 회색 밝음 어둠 따뜻함 시원함 뜨거움 차가움
크다 작다 길다 짧다 둥글다 네모 빠르다 느리다 새롭다 오래되다 젊다 좋다 나쁘다 부드럽다 단단하다 달다 시다
신선함 건조함 젖음 무거움 가벼움 큰소리 작은소리 쉬움 어려움 안전 조심
의사 간호사 화가 운전사 농부 제빵사 요리사 경찰 조종사 가수 배우 작가 디자이너 기술자 치과의사 미용사 점원
음악 영화 사진 그림 이야기 노래 게임 파티 소풍 취미 꿈 생각 뉴스 라디오 카메라 텔레비전 공연
몸 머리 얼굴 머리카락 눈동자 코 입 귀 손 팔 다리 발 손가락 이 치아 목 어깨 무릎 심장
도시 마을 나라 공원 해변 병원 은행 박물관 극장 식당 카페 빵집 약국 공장 교회
침대 소파 선반 서랍 옷장 카펫 커튼 바구니 양동이 열쇠 자물쇠 종 양초 건전지 충전기 전선
월요일 화요일 수요일 목요일 금요일 토요일 일요일 일월 이월 삼월 사월 오월 유월 칠월 팔월 구월 시월 십일월 십이월
안녕 작별 부탁 감사 미안 환영 예 아니오 아마 항상 절대 자주 가끔 함께 혼자 여기 저기 안쪽 바깥쪽
색깔 모양 숫자 이름 주소 생일 날씨 온도 소리 목소리 언어 글자 단어 문장
축구 야구 테니스 골프 농구 배구 볼링 스케이트 등산 캠핑 낚시 달리기 사이클
토마토 감자 양파 당근 양배추 오이 호박 옥수수 콩 버섯 마늘 상추 시금치 고추
장미 튤립 백합 데이지 해바라기 대나무 소나무 단풍나무 참나무 씨앗 뿌리 가지 열매 채소
비행기 배 트럭 승합차 킥보드 엘리베이터 에스컬레이터 입구 출구 모서리 가운데 앞 뒤 왼쪽 오른쪽
은 금 구리 나무재료 플라스틱 금속 면 양털 가죽 고무
햇빛 달빛 그림자 무지개 천둥 번개 안개 산들바람 폭풍
약속 비밀 농담 추억 기회 이유 계획표 목표 결과 실수 성공 문제 해결
관리자 주인 일꾼 방문객 승객 회원 팀 모임 군중 연인
온라인 누리집 메시지 비밀번호 계정 소개 내려받기 올리기 검색 누르기 만지기
건강 운동 약 비타민 열 기침 두통 복통 치통 붕대
영 하나 둘 셋 넷 다섯 여섯 일곱 여덟 아홉 열 백 천
`.trim().split(/\s+/)

export const TYPING_WORDS = [...new Set([...ENGLISH_WORDS, ...KOREAN_WORDS])]
