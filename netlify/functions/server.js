const serverless = require('serverless-http');
const app = require('../../app');

// Express 앱을 Netlify Functions로 내보내기
module.exports.handler = serverless(app);
