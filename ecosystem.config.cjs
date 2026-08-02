module.exports = {
  apps: [
    {
      name: 'trueid-point-poker',
      cwd: __dirname,
      script: 'npm',
      args: 'run dev',
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: '5s',
      env: {
        NODE_ENV: 'development',
        PORT: '3002',
      },
    },
    {
      name: 'trueid-portal',
      cwd: __dirname,
      script: 'node',
      args: 'portal/server.mjs',
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: '5s',
      env: {
        PORT: '5170',
      },
    },
  ],
}
