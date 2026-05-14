import createError from 'http-errors';
import express from 'express';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import crypto from "node:crypto";

import indexRouter from './routes/index.mjs';
import { open } from './lib/sql/index.mjs';
import { smartRedirect } from './lib/utils.mjs';

const __dirname = import.meta.dirname;

const app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.locals = {
  database: open(),
  auth: {
    secret: crypto.randomBytes(256),
    password: {
      admin: null,
    }
  }
};

app.use('/', indexRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  res.status(err.status || 500);

  // Gracefully handle HTMX errors without shattering the DOM
  if (req.get('HX-Request')) {
    return smartRedirect(req, res, '/?toast=error');
  }

  res.render('error');
});

export default app;
