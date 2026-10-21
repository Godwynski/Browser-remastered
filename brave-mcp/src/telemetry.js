import { globalTelemetry } from './telemetry-server.js';

class TelemetryClient {
  constructor(port = 8765) {
    this.port = port;
  }

  _notifyRemote(text, level = 'info') {
    // Only fetch if running out-of-process
    if (!globalTelemetry.server) {
      fetch(`http://localhost:${this.port}/api/telemetry/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, level })
      }).catch(() => {});
    }
  }

  startTask(id, name, subject = 'Browser Agent', totalSteps = 1) {
    globalTelemetry.startTask(id, name, subject, totalSteps);
    console.error(`[TELEMETRY] Task Started: ${name} [${subject}] (Steps: ${totalSteps})`);
    this._notifyRemote(`🚀 Task Started: ${name} [${subject}]`, 'info');
  }

  step(currentStep, totalSteps, stepName) {
    globalTelemetry.step(currentStep, totalSteps, stepName);
    console.error(`[TELEMETRY] [${currentStep}/${totalSteps}] ${stepName}`);
    this._notifyRemote(`📌 [${currentStep}/${totalSteps}] ${stepName}`, 'step');
  }

  log(text, level = 'info') {
    globalTelemetry.log(text, level);
    console.error(`[TELEMETRY] [${level.toUpperCase()}] ${text}`);
    this._notifyRemote(text, level);
  }

  complete(summary = 'Task completed successfully') {
    globalTelemetry.complete(summary);
    console.error(`[TELEMETRY] Completed: ${summary}`);
    this._notifyRemote(`✅ ${summary}`, 'success');
  }

  error(errMsg) {
    globalTelemetry.error(errMsg);
    console.error(`[TELEMETRY] Error: ${errMsg}`);
    this._notifyRemote(`❌ Error: ${errMsg}`, 'error');
  }
}

export const telemetry = new TelemetryClient();
