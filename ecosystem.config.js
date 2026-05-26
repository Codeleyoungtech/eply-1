module.exports = {
  apps: [
    {
      name: 'eply',
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'production',
      },
      // Ensure logs are kept in a accessible place
      error_file: './temp/logs/pm2_error.log',
      out_file: './temp/logs/pm2_out.log',
      merge_logs: true,
      time: true
    },
  ],
};
