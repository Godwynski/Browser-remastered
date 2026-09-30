import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, '../src/index.js');

console.log("🧪 Testing MCP Protocol communication with brave-mcp server...");

const proc = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit']
});

let outputData = '';

proc.stdout.on('data', (chunk) => {
  outputData += chunk.toString();
  const lines = outputData.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    if (line) {
      try {
        const msg = JSON.parse(line);
        console.log("📥 Received MCP response:", msg.id, msg.result ? 'SUCCESS' : 'DATA');
        if (msg.id === 1) {
          console.log("✅ MCP Server successfully initialized!");
          console.log("   Server Info:", JSON.stringify(msg.result.serverInfo));
          // Now request tools list
          const listToolsReq = JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {}
          }) + '\n';
          proc.stdin.write(listToolsReq);
        } else if (msg.id === 2) {
          console.log(`✅ Discovered ${msg.result.tools.length} core tools:`);
          msg.result.tools.forEach(t => console.log(`   - ${t.name}: ${t.description.slice(0, 70)}...`));
          console.log("\n🎉 All MCP protocol tests passed!");
          proc.kill();
          process.exit(0);
        }
      } catch (err) {
        // Not a complete JSON line yet
      }
    }
  }
  outputData = lines[lines.length - 1];
});

// Send initialize request
const initReq = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' }
  }
}) + '\n';

proc.stdin.write(initReq);

setTimeout(() => {
  console.error("❌ Test timed out waiting for MCP response.");
  proc.kill();
  process.exit(1);
}, 6000);
