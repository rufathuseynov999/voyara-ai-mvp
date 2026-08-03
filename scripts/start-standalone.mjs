process.env.HOSTNAME = process.env.VOYARA_HOSTNAME || '0.0.0.0';
await import('../.next/standalone/server.js');
