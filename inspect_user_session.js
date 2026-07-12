// inspect_user_session.js
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host:     process.env.POSTGRES_HOST || 'localhost',
  port:     Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || 'openmanus',
  user:     process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
});

async function main() {
  try {
    const res = await pool.query('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 1');
    const session = res.rows[0];
    if (!session) {
      console.log('No sessions found in database.');
      await pool.end();
      return;
    }

    console.log('=== LATEST SESSION ===');
    console.log('ID:', session.id);
    console.log('Goal:', session.goal);
    console.log('Status:', session.status);
    console.log('Result:', session.result);
    console.log('Created At:', session.created_at);
    
    console.log('\n=== MESSAGE HISTORY ===');
    session.history.forEach((msg, idx) => {
      console.log(`\n--- Message ${idx + 1} (${msg.role}) ---`);
      console.log('Content:', msg.content);
      if (msg.tool_calls) {
        console.log('Tool Calls:', JSON.stringify(msg.tool_calls, null, 2));
      }
    });

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

main();
