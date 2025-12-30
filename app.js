var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");

// routes는 항상 상대 경로로 require (번들링 시점에 해결됨)
var indexRouter = require("./routes/index");

var app = express();

// view engine setup
// Netlify Functions 환경: views는 같은 디렉토리에 복사됨
const viewsPath = process.env.NETLIFY 
  ? path.join(__dirname, 'views')      // Netlify Functions 환경
  : path.join(__dirname, 'views');      // 로컬 환경 (동일)

app.set("views", viewsPath);
app.set("view engine", "ejs");

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Netlify에서 public은 별도로 서빙됨 (CDN)
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

app.use("/", indexRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render("fail", {
    code: "UNKNOWN_ERROR",
    message: "알 수 없는 에러가 발생했습니다.",
  });
});

const PORT = process.env.PORT || 8080;

// Netlify Functions에서는 listen하지 않음
if (!process.env.NETLIFY && process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`http://localhost:${PORT} 으로 샘플 앱이 실행되었습니다.`);
  });
}

module.exports = app;