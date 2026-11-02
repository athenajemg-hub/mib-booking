const { Pool, types } = require('pg');

// NUMERIC -> number, DATE -> 'YYYY-MM-DD' string (avoids timezone shifts)
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(1082, (v) => v);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = { pool, query: (text, params) => pool.query(text, params) };
