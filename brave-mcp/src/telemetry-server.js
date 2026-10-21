import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const WORKSPACE_ROOT = path.resolve(__dirname, '../../');

export class TelemetryServer {
  constructor(port = 8765) {
    this.port = port;
    this.server = null;
    this.wss = null;
    this.clients = new Set();
    this.directives = [];
    this.extWatcher = null;
    this.currentTask = {
      id: null,
      name: 'Idle',
      subject: 'Browser Agent',
      status: 'IDLE',
      currentStep: 0,
      totalSteps: 0,
      stepName: 'Ready for browser operations',
      progress: 0,
      logs: []
    };
  }

  start() {
    if (this.server) return Promise.resolve();

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // Restrict CORS to localhost and browser extension
        const origin = req.headers.origin || '';
        const isAllowedOrigin = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || origin.startsWith('chrome-extension://');
        if (isAllowedOrigin && origin) {
          res.setHeader('Access-Control-Allow-Origin', origin);
        } else if (!origin) {
          res.setHeader('Access-Control-Allow-Origin', '*');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(isAllowedOrigin ? 204 : 403);
          res.end();
          return;
        }

        if (origin && !isAllowedOrigin) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden origin' }));
          return;
        }

        const url = new URL(req.url, `http://localhost:${this.port}`);

        // 1. Health API
        if (url.pathname === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', task: this.currentTask, version: '2.0.0' }));
          return;
        }

        // 2. Directives API (from Browser In-Page HUD Command Bar)
        if (url.pathname === '/api/directives' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ directives: this.directives }));
          return;
        }

        if (url.pathname === '/api/directives/clear' && req.method === 'POST') {
          this.directives = [];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        if (url.pathname === '/api/directives/submit' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const { prompt, url: pageUrl, title } = JSON.parse(body);
              if (!prompt) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Prompt is required' }));
                return;
              }
              const directiveId = `dir_${Date.now()}`;
              const entry = { id: directiveId, prompt, url: pageUrl, title, timestamp: new Date().toISOString() };
              this.directives.push(entry);
              if (this.directives.length > 100) this.directives.shift();
              this.log(`📩 [HUD Directive] "${prompt}"`, 'step');
              this.broadcast('DIRECTIVE_RECEIVED', entry);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, id: directiveId, message: 'Directive queued for Antigravity' }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        // 3. Telemetry Log API
        if (url.pathname === '/api/telemetry/log' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              this.log(data.text, data.level || 'info');
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        // 4. Static Dashboard Files Serving
        const cleanPath = (url.pathname === '/' || url.pathname === '/dashboard') ? 'index.html' : url.pathname.replace(/^\/+/, '');
        const filePath = path.resolve(PUBLIC_DIR, cleanPath);
        const resolvedPublic = path.resolve(PUBLIC_DIR);

        // Path traversal protection: ensure file path remains strictly within PUBLIC_DIR
        if ((filePath === resolvedPublic || filePath.startsWith(resolvedPublic + path.sep)) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.png': 'image/png',
            '.json': 'application/json'
          };
          res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
          fs.createReadStream(filePath).pipe(res);
          return;
        }

        res.writeHead(404);
        res.end('Not Found');
      });

      this.wss = new WebSocketServer({ server: this.server });

      this.wss.on('error', (err) => {
        if (err.code !== 'EADDRINUSE') {
          console.error('[Telemetry] WebSocket server error:', err.message);
        }
      });

      this.wss.on('connection', (ws) => {
        this.clients.add(ws);
        ws.send(JSON.stringify({ type: 'STATE_SNAPSHOT', data: this.currentTask }));

        ws.on('message', (message) => {
          try {
            const msg = JSON.parse(message.toString());
            this.handleClientMessage(msg);
          } catch (err) {
            console.error('[Telemetry] Invalid message:', err.message);
          }
        });

        ws.on('close', () => { this.clients.delete(ws); });
        ws.on('error', () => { this.clients.delete(ws); });
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.error(`📡 [Telemetry] Real-time HUD server listening on ws://localhost:${this.port}`);

        // Auto-hot-reload file watcher for extension files
        const extDir = path.join(WORKSPACE_ROOT, 'brave-extension');
        if (fs.existsSync(extDir)) {
          let reloadTimer = null;
          try {
            this.extWatcher = fs.watch(extDir, { recursive: true }, (eventType, filename) => {
              if (filename && !filename.includes('node_modules') && !filename.endsWith('.tmp')) {
                if (reloadTimer) clearTimeout(reloadTimer);
                reloadTimer = setTimeout(() => {
                  console.error(`⚡ [Telemetry] Change detected in brave-extension/${filename}. Broadcasting hot-reload...`);
                  this.broadcast('HOT_RELOAD_EXTENSION', { file: filename });
                }, 300);
              }
            });
          } catch (e) {
            console.error('[Telemetry] Could not start extension file watcher:', e.message);
          }
        }

        resolve();
      });

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`📡 [Telemetry] Port ${this.port} in use, attaching to existing...`);
          this.server = null;
          this.wss = null;
          resolve();
        } else {
          reject(err);
        }
      });
    });
  }

  handleClientMessage(msg) {
    const { type, payload } = msg;

    if (type === 'DIRECTIVE_SUBMIT' && payload) {
      const { prompt, url, title } = payload;
      const dirId = `dir_${Date.now()}`;
      const entry = { id: dirId, prompt, url, title, timestamp: new Date().toISOString() };
      this.directives.push(entry);
      if (this.directives.length > 100) this.directives.shift();
      this.log(`📩 [HUD Directive] "${prompt}"`, 'step');
      this.broadcast('DIRECTIVE_RECEIVED', entry);
    }
  }

  broadcast(type, data) {
    const payload = JSON.stringify({ type, data });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  startTask(id, name, subject = 'Browser Agent', totalSteps = 1) {
    this.currentTask = {
      id,
      name,
      subject,
      status: 'RUNNING',
      currentStep: 1,
      totalSteps,
      stepName: 'Starting task...',
      progress: Math.round((1 / totalSteps) * 100),
      logs: []
    };
    this.broadcast('TASK_START', this.currentTask);
    this.log(`🚀 Task Started: ${name} [${subject}]`, 'info');
  }

  step(currentStep, totalSteps, stepName) {
    this.currentTask.currentStep = currentStep;
    this.currentTask.totalSteps = totalSteps;
    this.currentTask.stepName = stepName;
    this.currentTask.progress = Math.min(100, Math.round((currentStep / totalSteps) * 100));
    this.broadcast('STEP_UPDATE', this.currentTask);
    this.log(`📌 [${currentStep}/${totalSteps}] ${stepName}`, 'step');
  }

  log(text, level = 'info') {
    const entry = {
      text,
      level,
      timestamp: new Date().toLocaleTimeString()
    };
    this.currentTask.logs.push(entry);
    if (this.currentTask.logs.length > 200) {
      this.currentTask.logs.shift();
    }
    this.broadcast('LOG', entry);
  }

  complete(summary = 'Task completed successfully') {
    this.currentTask.status = 'COMPLETED';
    this.currentTask.progress = 100;
    this.currentTask.stepName = 'Completed';
    this.broadcast('TASK_COMPLETE', { summary, task: this.currentTask });
    this.log(`✅ ${summary}`, 'success');
  }

  error(errMsg = 'Task encountered an error') {
    this.currentTask.status = 'ERROR';
    this.broadcast('TASK_ERROR', { error: errMsg, task: this.currentTask });
    this.log(`❌ Error: ${errMsg}`, 'error');
  }

  stop() {
    if (this.extWatcher) {
      this.extWatcher.close();
      this.extWatcher = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }
}

export const globalTelemetry = new TelemetryServer(8765);
