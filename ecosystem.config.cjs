// PM2 配置文件 - Universal Webhook POC
// API 服务 + 2 个 Worker 消费者
module.exports = {
  apps: [
    {
      name: 'webhook-api',
      script: 'python3',
      args: '-u -m uvicorn app.main:app --host 0.0.0.0 --port 8000',
      cwd: '/home/user/webapp',
      env: {
        PYTHONPATH: '/home/user/webapp',
        PYTHONUNBUFFERED: '1',
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      out_file: '/home/user/webapp/logs/api.log',
      error_file: '/home/user/webapp/logs/api-err.log',
    },
    {
      name: 'webhook-worker-1',
      script: 'python3',
      args: '-u worker/worker.py',
      cwd: '/home/user/webapp',
      env: {
        PYTHONPATH: '/home/user/webapp',
        PYTHONUNBUFFERED: '1',
        STREAM_CONSUMER: 'worker-1',
        STREAM_GROUP: 'uw-worker-group',
        STREAM_KEY_RAW: 'uw:webhook:raw',
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      out_file: '/home/user/webapp/logs/worker-1.log',
      error_file: '/home/user/webapp/logs/worker-1-err.log',
    },
    {
      name: 'webhook-worker-2',
      script: 'python3',
      args: '-u worker/worker.py',
      cwd: '/home/user/webapp',
      env: {
        PYTHONPATH: '/home/user/webapp',
        PYTHONUNBUFFERED: '1',
        STREAM_CONSUMER: 'worker-2',
        STREAM_GROUP: 'uw-worker-group',
        STREAM_KEY_RAW: 'uw:webhook:raw',
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      out_file: '/home/user/webapp/logs/worker-2.log',
      error_file: '/home/user/webapp/logs/worker-2-err.log',
    },
  ],
}
