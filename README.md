# pharmchecker

간단한 약국용 투약 확인 웹 애플리케이션 (모의 서버 포함).

주요 기능
- 환자 검색 (이름 / 생년월일 / 처방전 번호)
- 처방약 목록 표시
- 바코드/QR 입력을 통한 투약 확인 및 기록
- 투약 불일치시 경고
- 관리자 화면에서 투약 로그 조회 및 필터링

빠른 시작
1. 종속성 설치:

```powershell
npm install
```

2. 서버 실행:

```powershell
npm start
# 서버가 기본적으로 http://localhost:3000 에서 실행됩니다
```

폴더 구조 예시

- data/
	- patients.json      # 예제 환자 및 처방 데이터
	- logs.json          # 투약 로그 (서버가 기록)
- public/
	- index.html         # 메인 UI (약사가 사용하는 화면)
	- admin.html         # 관리자 로그 조회 화면
	- main.js            # 메인 화면 JS
	- admin.js           # 관리자 화면 JS
	- styles.css         # 스타일
- server.js            # Express 모의 API 서버

설계 노트
- 서버는 간단한 모의 API로 구현되어 있으며 JSON 파일을 읽고 씁니다.
- 실제 배포 시에는 데이터베이스와 인증(예: OAuth, SSO)을 추가해야 합니다.

주의
- 이 저장소는 교육/프로토타입 용으로 실제 의료정보 시스템에 사용하기 전 보안/감사/인증 요구사항을 충족하도록 추가 작업이 필요합니다.

# pharmchecker