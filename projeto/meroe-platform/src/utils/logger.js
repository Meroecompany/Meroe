// src/utils/logger.js — Winston logger melhorado
'use strict';
const winston = require('winston');
const path    = require('path');
const { combine, timestamp, errors, json, colorize, printf } = winston.format;
const isProd = process.env.NODE_ENV === 'production';

const devFormat = printf(({ level, message, timestamp: ts, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  return `${ts} [${level}] ${message}${metaStr}`;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), json()),
  defaultMeta: { service: 'meroe-platform', version: '2.0.0', env: process.env.NODE_ENV || 'development' },
  transports: [
    new winston.transports.Console({
      format: isProd ? json() : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), devFormat),
    }),
    ...(isProd ? [
      new winston.transports.File({
        filename: path.join('logs', 'error.log'),
        level: 'error', maxsize: 10 * 1024 * 1024, maxFiles: 5, tailable: true,
      }),
      new winston.transports.File({
        filename: path.join('logs', 'combined.log'),
        maxsize: 50 * 1024 * 1024, maxFiles: 10, tailable: true,
      }),
    ] : []),
  ],
  exitOnError: false,
});

logger.stream = { write: (message) => logger.info(message.trim()) };
module.exports = { logger };
