(() => {
  const WS_URL = `ws://${window.location.host}`;
  let socket = null;
  const directives = [];

  // DOM Elements
  const wsDot = document.getElementById('ws-dot');
  const wsLabel = document.getElementById('ws-label');
  const bannerSubject = document.getElementById('banner-subject');
  const bannerTitle = document.getElementById('banner-title');
  const bannerStep = document.getElementById('banner-step');
  const bannerPercent = document.getElementById('banner-percent');
  const bannerProgressFill = document.getElementById('banner-progress-fill');
  const bannerStatusText = document.getElementById('banner-status-text');
  const terminalLogs = document.getElementById('terminal-logs');
  const directiveInput = document.getElementById('dashboard-directive-input');
  const btnSubmitDirective = document.getElementById('btn-submit-directive');
  const directivesList = document.getElementById('directives-list');
  const btnClearTerm = document.getElementById('btn-clear-term');
  const btnHealthCheck = document.getElementById('btn-health-check');

  function appendTerminalLog(text, level = 'info', time = null) {
    const timeStr = time || new Date().toLocaleTimeString();
    const row = document.createElement('div');
    row.className = `log-row ${level}`;
    row.innerHTML = `<span class="time">${timeStr}</span>${escapeHtml(text)}`;
    terminalLogs.appendChild(row);
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  }

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function updateMissionUI(task) {
    if (!task) return;
    bannerSubject.textContent = (task.subject || 'BROWSER AGENT').toUpperCase();
    bannerTitle.textContent = task.name || 'Idle — Waiting for Operations';
    bannerStep.textContent = task.stepName || 'No script currently executing';
    const percent = task.progress || 0;
    bannerPercent.textContent = `${percent}%`;
    bannerProgressFill.style.width = `${percent}%`;

    if (task.status === 'RUNNING') {
      bannerStatusText.textContent = `Running (Step ${task.currentStep || 1} of ${task.totalSteps || 1})`;
      bannerSubject.style.color = '#f59e0b';
      bannerSubject.style.borderColor = 'rgba(245, 158, 11, 0.4)';
    } else if (task.status === 'COMPLETED') {
      bannerStatusText.textContent = 'Completed';
      bannerSubject.style.color = '#10b981';
      bannerSubject.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    } else if (task.status === 'ERROR') {
      bannerStatusText.textContent = 'Error';
      bannerSubject.style.color = '#ef4444';
      bannerSubject.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    } else {
      bannerStatusText.textContent = 'Ready for operations';
      bannerSubject.style.color = '#38bdf8';
      bannerSubject.style.borderColor = 'rgba(56, 189, 248, 0.3)';
    }
  }

  function renderDirectives() {
    if (!directivesList) return;
    if (directives.length === 0) {
      directivesList.innerHTML = '<div class="empty-state">No directives queued. Type above to dispatch one.</div>';
      return;
    }
    directivesList.innerHTML = directives.map(d => `
      <div class="directive-card" style="padding:10px 14px; background:rgba(30,41,59,0.7); border:1px solid rgba(56,189,248,0.2); border-radius:8px; margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; font-size:11px; color:#94a3b8; margin-bottom:4px;">
          <span>${new Date(d.timestamp).toLocaleTimeString()}</span>
          <span style="color:#38bdf8; font-weight:600;">QUEUED</span>
        </div>
        <div style="font-size:13px; font-weight:600; color:#f8fafc;">${escapeHtml(d.prompt)}</div>
      </div>
    `).join('');
  }

  async function submitDirective() {
    const text = (directiveInput.value || '').trim();
    if (!text) return;
    directiveInput.value = '';

    appendTerminalLog(`Dispatching directive: "${text}"`, 'step');
    try {
      const resp = await fetch('/api/directives/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, url: 'Dashboard', title: 'Mission Control' })
      });
      const res = await resp.json();
      if (res.success) {
        appendTerminalLog(`Directive acknowledged: [${res.id}]`, 'success');
      }
    } catch (e) {
      appendTerminalLog(`Error: ${e.message}`, 'error');
    }
  }

  btnSubmitDirective?.addEventListener('click', submitDirective);
  directiveInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitDirective();
    }
  });

  btnClearTerm?.addEventListener('click', () => {
    terminalLogs.innerHTML = '';
  });

  btnHealthCheck?.addEventListener('click', async () => {
    appendTerminalLog('Pinging daemon health endpoint...', 'step');
    try {
      const res = await fetch('/health');
      const data = await res.json();
      appendTerminalLog(`System Health: ${data.status.toUpperCase()} (v${data.version || '2.0'}) | Active Task: ${data.task?.name || 'Idle'}`, 'success');
    } catch (e) {
      appendTerminalLog(`Health check failed: ${e.message}`, 'error');
    }
  });

  function connect() {
    try {
      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        wsDot.className = 'status-indicator online';
        wsLabel.textContent = 'Live Telemetry Connected';
        appendTerminalLog('Connected to Antigravity Mission Control Daemon', 'success');
      };

      socket.onmessage = (event) => {
        try {
          const { type, data } = JSON.parse(event.data);
          if (type === 'STATE_SNAPSHOT') {
            updateMissionUI(data);
            if (data.logs && Array.isArray(data.logs)) {
              terminalLogs.innerHTML = '';
              data.logs.slice(-50).forEach(l => appendTerminalLog(l.text, l.level, l.timestamp));
            }
          } else if (type === 'TASK_START' || type === 'STEP_UPDATE') {
            updateMissionUI(data);
          } else if (type === 'LOG') {
            appendTerminalLog(data.text, data.level, data.timestamp);
          } else if (type === 'TASK_COMPLETE') {
            updateMissionUI(data.task);
            appendTerminalLog(`✅ ${data.summary}`, 'success');
          } else if (type === 'TASK_ERROR') {
            updateMissionUI(data.task);
            appendTerminalLog(`❌ ${data.error}`, 'error');
          } else if (type === 'DIRECTIVE_RECEIVED') {
            directives.unshift(data);
            renderDirectives();
          }
        } catch (err) {
          console.error('[Dashboard] Parse error:', err);
        }
      };

      socket.onclose = () => {
        wsDot.className = 'status-indicator offline';
        wsLabel.textContent = 'Telemetry Disconnected';
        setTimeout(connect, 2500);
      };

      socket.onerror = () => {
        socket.close();
      };
    } catch (e) {
      setTimeout(connect, 2500);
    }
  }

  connect();
})();
