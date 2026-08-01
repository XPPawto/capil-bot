const path = require("path");

module.exports = {
  apps: [
    {
      name: "kelurahan-bot",
      cwd: path.resolve(__dirname, "apps/bot"),
      script: "npm",
      args: "run start",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      watch: false,
    },
    {
      name: "kelurahan-web",
      cwd: path.resolve(__dirname, "apps/web"),
      script: "npm",
      args: "run start",
      interpreter: "none",
      env: { NODE_ENV: "production" },
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      watch: false,
    },
  ],
};
