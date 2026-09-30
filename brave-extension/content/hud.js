(() => {
  if (document.getElementById('antigravity-hud-root')) return;

  const WS_URL = 'ws://localhost:8765';
  let socket = null;
  let isConnected = false;
  let isExpanded = localStorage.getItem('ag_hud_expanded') === 'true';
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };

  // Create root container
  const root = document.createElement('div');
  root.id = 'antigravity-hud-root';

  // Restore saved position
  const savedPos = JSON.parse(localStorage.getItem('ag_hud_pos') || 'null');
  if (savedPos && savedPos.x !== undefined && savedPos.y !== undefined) {
    root.style.left = `${savedPos.x}px`;
    root.style.top = `${savedPos.y}px`;
  } else {
    root.style.right = '24px';
    root.style.bottom = '24px';
  }

  // HTML Template
  root.innerHTML = `
    <!-- Collapsed Floating Pill -->
    <div id="antigravity-pill" style="${isExpanded ? 'display: none;' : 'display: flex;'}">
      <div class="ag-pulse-dot offline" id="ag-pill-dot"></div>
      <span class="ag-pill-logo">⚡ ANTIGRAVITY</span>
      <span class="ag-pill-status" id="ag-pill-status">Connecting...</span>
    </div>

    <!-- Expanded Mission Control Window -->
    <div id="antigravity-window" style="${isExpanded ? 'display: flex;' : 'display: none;'}">
      <div class="ag-header" id="ag-drag-handle">
        <div class="ag-header-left">
          <span class="ag-header-title">⚡ ANTIGRAVITY MISSION CONTROL</span>
          <span class="ag-conn-badge offline" id="ag-conn-badge">Connecting</span>
        </div>
        <div class="ag-header-actions">
          <button class="ag-icon-btn" id="ag-btn-reset-pos" title="Reset Position">↺</button>
          <button class="ag-icon-btn" id="ag-btn-minimize" title="Minimize">—</button>
        </div>
      </div>

      <div class="ag-task-card">
        <div class="ag-task-subject" id="ag-task-subject">BROWSER AGENT</div>
        <div class="ag-task-name" id="ag-task-name">Idle — Ready for Operations</div>
        <div class="ag-task-step">
          <span id="ag-task-step-name">No active task</span>
          <span id="ag-task-percent">0%</span>
        </div>
        <div class="ag-progress-bar">
          <div class="ag-progress-fill" id="ag-progress-fill" style="width: 0%;"></div>
        </div>
      </div>

      <div class="ag-console-header">
        <span>LIVE TELEMETRY LOGS</span>
        <button class="ag-icon-btn" id="ag-btn-clear-logs" style="font-size: 10px;">Clear</button>
      </div>
      <div class="ag-console-box" id="ag-console-box">
        <div class="ag-log-line"><span class="ag-log-time">${new Date().toLocaleTimeString()}</span>Waiting for Antigravity connection...</div>
      </div>

      <div class="ag-toolbar" style="grid-template-columns: repeat(3, 1fr);">
        <button class="ag-btn ag-btn-primary" id="ag-action-inspect-page" title="Inspect current page state">🔍 Inspect Page</button>
        <button class="ag-btn" id="ag-action-health-check" title="Check MCP server status">📡 Status</button>
        <button class="ag-btn" id="ag-action-clear-logs" title="Clear console output">🧹 Clear</button>
      </div>

      <!-- AI Directive Command Bar -->
      <div class="ag-directive-container">
        <input type="text" class="ag-directive-input" id="ag-directive-input" placeholder="Type AI directive (e.g. 'Extract all table data')..." />
        <button class="ag-directive-btn" id="ag-btn-send-directive" title="Send Directive to Antigravity">➤</button>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  // DOM References
  const pill = document.getElementById('antigravity-pill');
  const windowEl = document.getElementById('antigravity-window');
  const dragHandle = document.getElementById('ag-drag-handle');
  const pillDot = document.getElementById('ag-pill-dot');
  const pillStatus = document.getElementById('ag-pill-status');
  const connBadge = document.getElementById('ag-conn-badge');
  const taskSubject = document.getElementById('ag-task-subject');
  const taskName = document.getElementById('ag-task-name');
  const taskStepName = document.getElementById('ag-task-step-name');
  const taskPercent = document.getElementById('ag-task-percent');
  const progressFill = document.getElementById('ag-progress-fill');
  const consoleBox = document.getElementById('ag-console-box');
  const directiveInput = document.getElementById('ag-directive-input');
  const sendDirectiveBtn = document.getElementById('ag-btn-send-directive');

  // Submit AI Directive
  async function submitDirective() {
    const text = (directiveInput.value || '').trim();
    if (!text) return;
    directiveInput.value = '';
    appendLog(`Directive: "${text}"`, 'step');

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'DIRECTIVE_SUBMIT',
        payload: {
          prompt: text,
          url: window.location.href,
          title: document.title
        }
      }));
    } else {
      fetch('http://localhost:8765/api/directives/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          url: window.location.href,
          title: document.title
        })
      }).catch(err => {
        appendLog(`Directive submission error: ${err.message}`, 'error');
      });
    }
  }

  sendDirectiveBtn?.addEventListener('click', submitDirective);
  directiveInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitDirective();
    }
  });

  // Action Buttons
  document.getElementById('ag-action-inspect-page')?.addEventListener('click', () => {
    const interactive = document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]').length;
    appendLog(`Page: "${document.title}" (${window.location.hostname})`, 'info');
    appendLog(`Interactive Elements: ${interactive} | Viewport: ${window.innerWidth}x${window.innerHeight}`, 'step');
  });

  document.getElementById('ag-action-health-check')?.addEventListener('click', async () => {
    try {
      const res = await fetch('http://localhost:8765/health');
      const data = await res.json();
      appendLog(`Daemon Health: ${data.status} | Task: ${data.task?.name || 'Idle'}`, 'success');
    } catch (e) {
      appendLog(`Daemon connection check failed: ${e.message}`, 'error');
    }
  });

  document.getElementById('ag-action-clear-logs')?.addEventListener('click', () => {
    consoleBox.innerHTML = '';
  });

  document.getElementById('ag-btn-clear-logs')?.addEventListener('click', () => {
    consoleBox.innerHTML = '';
  });

  // Window Expand / Minimize Toggle
  pill?.addEventListener('click', () => {
    isExpanded = true;
    localStorage.setItem('ag_hud_expanded', 'true');
    pill.style.display = 'none';
    windowEl.style.display = 'flex';
  });

  document.getElementById('ag-btn-minimize')?.addEventListener('click', () => {
    isExpanded = false;
    localStorage.setItem('ag_hud_expanded', 'false');
    windowEl.style.display = 'none';
    pill.style.display = 'flex';
  });

  document.getElementById('ag-btn-reset-pos')?.addEventListener('click', () => {
    localStorage.removeItem('ag_hud_pos');
    root.style.left = '';
    root.style.top = '';
    root.style.right = '24px';
    root.style.bottom = '24px';
  });

  // Draggable Window Handling
  dragHandle?.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    isDragging = true;
    const rect = root.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    if (!isDragging) return;
    const newX = Math.max(10, Math.min(window.innerWidth - 450, e.clientX - dragOffset.x));
    const newY = Math.max(10, Math.min(window.innerHeight - 300, e.clientY - dragOffset.y));
    root.style.left = `${newX}px`;
    root.style.top = `${newY}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  }

  function onMouseUp() {
    if (!isDragging) return;
    isDragging = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    const rect = root.getBoundingClientRect();
    localStorage.setItem('ag_hud_pos', JSON.stringify({ x: rect.left, y: rect.top }));
  }

  // Live Logging Helper
  function appendLog(text, level = 'info', time = null) {
    const timeStr = time || new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `ag-log-line ${level}`;
    entry.innerHTML = `<span class="ag-log-time">${timeStr}</span>${escapeHtml(text)}`;
    consoleBox.appendChild(entry);
    consoleBox.scrollTop = consoleBox.scrollHeight;
  }

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  // Update HUD UI State
  function updateUI(task) {
    if (!task) return;
    taskSubject.textContent = (task.subject || 'BROWSER AGENT').toUpperCase();
    taskName.textContent = task.name || 'Idle — Ready for Operations';
    taskStepName.textContent = task.stepName || 'No active task';
    const percent = task.progress || 0;
    taskPercent.textContent = `${percent}%`;
    progressFill.style.width = `${percent}%`;

    if (task.status === 'RUNNING') {
      pillDot.className = 'ag-pulse-dot running';
      pillStatus.textContent = task.name;
      connBadge.textContent = 'Running';
      connBadge.className = 'ag-conn-badge';
    } else {
      pillDot.className = 'ag-pulse-dot';
      pillStatus.textContent = isConnected ? 'Ready' : 'Offline';
      connBadge.textContent = isConnected ? 'Connected' : 'Offline';
      connBadge.className = isConnected ? 'ag-conn-badge' : 'ag-conn-badge offline';
    }
  }

  // WebSocket Connection Lifecycle
  function connect() {
    try {
      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        isConnected = true;
        connBadge.className = 'ag-conn-badge';
        connBadge.textContent = 'Connected';
        pillDot.className = 'ag-pulse-dot';
        pillStatus.textContent = 'Ready';
        appendLog('Connected to Antigravity Mission Control', 'success');
      };

      socket.onmessage = (event) => {
        try {
          const { type, data } = JSON.parse(event.data);
          if (type === 'STATE_SNAPSHOT') {
            updateUI(data);
            if (data.logs && Array.isArray(data.logs)) {
              consoleBox.innerHTML = '';
              data.logs.slice(-30).forEach(l => appendLog(l.text, l.level, l.timestamp));
            }
          } else if (type === 'TASK_START' || type === 'STEP_UPDATE') {
            updateUI(data);
          } else if (type === 'LOG') {
            appendLog(data.text, data.level, data.timestamp);
          } else if (type === 'TASK_COMPLETE') {
            updateUI(data.task);
            appendLog(`✅ ${data.summary}`, 'success');
          } else if (type === 'TASK_ERROR') {
            updateUI(data.task);
            appendLog(`❌ ${data.error}`, 'error');
          } else if (type === 'HOT_RELOAD_EXTENSION') {
            appendLog('⚡ Extension hot-reload broadcast received.', 'info');
          }
        } catch (err) {
          console.error('[HUD] Message parse error:', err);
        }
      };

      socket.onclose = () => {
        isConnected = false;
        connBadge.className = 'ag-conn-badge offline';
        connBadge.textContent = 'Offline';
        pillDot.className = 'ag-pulse-dot offline';
        pillStatus.textContent = 'Offline';
        setTimeout(connect, 3000);
      };

      socket.onerror = () => {
        socket.close();
      };
    } catch (e) {
      setTimeout(connect, 3000);
    }
  }

  connect();
})();
