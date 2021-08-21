const fs = require('fs')
const path = require('path')
const express = require('express')
const bodyParser = require('body-parser')
const request = require('./util/request')
const cache = require('./util/apicache').middleware
const { cookieToJson } = require('./util/index')
const fileUpload = require('express-fileupload')
const http = require('http');

const app = express()

const buildResponseHeader = (headers = {}) => ({
  ...headers,
  'Access-Control-Allow-Origin': headers.origin || '*',
  'Access-Control-Allow-Credentials': true,
  'Access-Control-Allow-Headers': 'X-Requested-With,Content-Type',
  'Access-Control-Allow-Methods': 'PUT,POST,GET,DELETE,OPTIONS',
});

// CORS & Preflight request
app.use((req, res, next) => {
  if (req.path !== '/' && !req.path.includes('.')) {
    res.set({
      'Access-Control-Allow-Credentials': true,
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Headers': 'X-Requested-With,Content-Type',
      'Access-Control-Allow-Methods': 'PUT,POST,GET,DELETE,OPTIONS',
      'Content-Type': 'application/json; charset=utf-8',
    })
  }
  req.method === 'OPTIONS' ? res.status(204).end() : next()
})

// cookie parser
app.use((req, res, next) => {
  req.cookies = {}
  ;(req.headers.cookie || '').split(/\s*;\s*/).forEach((pair) => {
    let crack = pair.indexOf('=')
    if (crack < 1 || crack == pair.length - 1) return
    req.cookies[
      decodeURIComponent(pair.slice(0, crack)).trim()
    ] = decodeURIComponent(pair.slice(crack + 1)).trim()
  })
  next()
})

// body parser
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))

app.use(fileUpload())

// cache
app.use(cache('2 minutes', (req, res) => res.statusCode === 200))
app.use('/getMusic', (req, res) => {
  const { id } = req.query;
  if (!id) {
    res.writeHead(403, buildResponseHeader({ 'Content-Type': 'application/json; charset=utf-8', }));
    res.write(JSON.stringify({ error: 'id is required' }));
    res.end();
    return;
  }

  const options = {
    method: 'GET',
    headers: {
      'accept-encoding': 'gzip, deflate, br',
      'accept-language': 'zh-CN,zh;q=0.9',
    },
    hostname: `music.163.com`,
    port: 80,
    path: `/song/media/outer/url?id=${id}`,
  };

  const httpReq = http.request(options, (httpRes) => {
    const serverData = [];
    httpRes.on('data', (chunk) => {
      serverData.push(chunk);
    });

    // 服务端数据接收完毕，返回客户端
    httpRes.on('end', () => {
      console.log(`[OK] /getMusic?id=${id}`);
      const serverBuffer = Buffer.concat(serverData);
      res.writeHead(200, buildResponseHeader(httpRes.headers));
      res.write(serverBuffer);
      res.end();
    });
  });

  httpReq.on('error', (err) => {
    console.log(`[ERR] /getMusic?id=${id}`);
    res.writeHead(500);
    res.write(JSON.stringify({ error: err }));
    res.end();
  });

  httpReq.end();
});

// router
const special = {
  'daily_signin.js': '/daily_signin',
  'fm_trash.js': '/fm_trash',
  'personal_fm.js': '/personal_fm',
}

fs.readdirSync(path.join(__dirname, 'module'))
  .reverse()
  .forEach((file) => {
    if (!file.endsWith('.js')) return
    let route =
      file in special
        ? special[file]
        : '/' + file.replace(/\.js$/i, '').replace(/_/g, '/')
    let question = require(path.join(__dirname, 'module', file))

    app.use(route, (req, res) => {
      if (typeof req.query.cookie === 'string') {
        req.query.cookie = cookieToJson(req.query.cookie)
      }
      let query = Object.assign(
        {},
        { cookie: req.cookies },
        req.query,
        req.body,
        req.files,
      )

      question(query, request)
        .then((answer) => {
          console.log('[OK]', decodeURIComponent(req.originalUrl))
          res.append('Set-Cookie', answer.cookie.map(item => item + 'SameSite=None; Secure;'))
          res.status(answer.status).send(answer.body)
        })
        .catch((answer) => {
          console.log('[ERR]', decodeURIComponent(req.originalUrl), {
            status: answer.status,
            body: answer.body,
          })
          if (answer.body.code == '301') answer.body.msg = '需要登录'
          res.append('Set-Cookie', answer.cookie)
          res.status(answer.status).send(answer.body)
        })
    })
  })

const port = process.env.PORT || 4001
const host = process.env.HOST || ''

app.server = app.listen(port, host, () => {
  console.log(`server running @ http://${host ? host : 'localhost'}:${port}`)
})

module.exports = app
