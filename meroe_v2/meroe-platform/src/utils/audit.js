// src/utils/audit.js
'use strict';
const { query } = require('../db/connection');
const { logger } = require('./logger');

async function auditLog({ userId, action, resourceType, resourceId, oldValue, newValue, ipAddress, userAgent, requestId, success = true, errorMessage }) {
  try {
    await query(
      `INSERT INTO audit_logs (user_id,action,resource_type,resource_id,old_value,new_value,ip_address,user_agent,request_id,success,error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [userId||null, action, resourceType||null, resourceId||null,
       oldValue ? JSON.stringify(oldValue) : null,
       newValue ? JSON.stringify(newValue) : null,
       ipAddress||null, userAgent?.substring(0,500)||null,
       requestId||null, success, errorMessage||null]
    );
  } catch (err) {
    logger.error('Falha ao registar audit log:', { action, error: err.message });
  }
}

module.exports = { auditLog };
