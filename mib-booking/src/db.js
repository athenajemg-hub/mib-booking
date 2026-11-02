const { Pool, types } = require('pg');

// NUMERIC -> number, DATE -> 'YYYY-MM-DD' string (avoids timezone shifts)
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(1082, (v) => v);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase and other online databases need SSL: set DATABASE_SSL=true
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

module.exports = { pool, query: (text, params) => pool.query(text, params) };
