// app.js를 불러와서 실행
require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 8080;

// 로컬 개발 환경에서만 서버 시작
if (!process.env.NETLIFY && process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`http://localhost:${PORT} 으로 샘플 앱이 실행되었습니다.`);
  });
}