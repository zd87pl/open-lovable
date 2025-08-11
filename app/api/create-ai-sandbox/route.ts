import { NextResponse } from 'next/server';
import { Sandbox } from '@e2b/code-interpreter';
import type { SandboxState } from '@/types/sandbox';
import { appConfig } from '@/config/app.config';

// Store active sandbox globally
declare global {
  var activeSandbox: any;
  var sandboxData: any;
  var existingFiles: Set<string>;
  var sandboxState: SandboxState;
}

// EventSource uses GET requests, so we need to export GET instead of POST
export async function GET() {
  let sandbox: any = null;

  // Check for required environment variable first
  if (!process.env.E2B_API_KEY) {
    console.error('[create-ai-sandbox] E2B_API_KEY environment variable is not set');
    return NextResponse.json(
      {
        error: 'E2B_API_KEY environment variable is not configured. Please set this in your deployment environment.',
        details: 'The E2B API key is required to create sandboxes. Get yours at https://e2b.dev'
      },
      { status: 500 }
    );
  }

  // Create a streaming response to bypass WP Engine Atlas 30s timeout
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      try {
        console.log('[create-ai-sandbox] Starting streaming sandbox creation...');
        console.log('[create-ai-sandbox] E2B_API_KEY is configured');
        
        // Send initial progress
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'progress',
          message: 'Starting sandbox creation...',
          step: 'init'
        })}\n\n`));
    
        // Kill existing sandbox if any
        if (global.activeSandbox) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'progress',
            message: 'Cleaning up existing sandbox...',
            step: 'cleanup'
          })}\n\n`));
          
          console.log('[create-ai-sandbox] Killing existing sandbox...');
          try {
            await global.activeSandbox.kill();
          } catch (e) {
            console.error('Failed to close existing sandbox:', e);
          }
          global.activeSandbox = null;
        }
        
        // Clear existing files tracking
        if (global.existingFiles) {
          global.existingFiles.clear();
        } else {
          global.existingFiles = new Set<string>();
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'progress',
          message: 'Creating E2B sandbox...',
          step: 'sandbox'
        })}\n\n`));

        // Create base sandbox - we'll set up Vite ourselves for full control
        console.log(`[create-ai-sandbox] Creating base E2B sandbox with ${appConfig.e2b.timeoutMinutes} minute timeout...`);
        sandbox = await Sandbox.create({
          apiKey: process.env.E2B_API_KEY,
          timeoutMs: appConfig.e2b.timeoutMs
        });
    
        const sandboxId = (sandbox as any).sandboxId || Date.now().toString();
        const host = (sandbox as any).getHost(appConfig.e2b.vitePort);
        
        console.log(`[create-ai-sandbox] Sandbox created: ${sandboxId}`);
        console.log(`[create-ai-sandbox] Sandbox host: ${host}`);

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'progress',
          message: 'Setting up React app files...',
          step: 'setup',
          sandboxId: sandboxId
        })}\n\n`));

        // Set up a basic Vite React app using Python to write files
        console.log('[create-ai-sandbox] Setting up Vite React app...');
    
    // Write all files in a single Python script to avoid multiple executions
    const setupScript = `
import os
import json

print('Setting up React app with Vite and Tailwind...')

# Create directory structure
os.makedirs('/home/user/app/src', exist_ok=True)

# Package.json
package_json = {
    "name": "sandbox-app",
    "version": "1.0.0",
    "type": "module",
    "scripts": {
        "dev": "vite --host",
        "build": "vite build",
        "preview": "vite preview"
    },
    "dependencies": {
        "react": "^18.2.0",
        "react-dom": "^18.2.0"
    },
    "devDependencies": {
        "@vitejs/plugin-react": "^4.0.0",
        "vite": "^4.3.9",
        "tailwindcss": "^3.3.0",
        "postcss": "^8.4.31",
        "autoprefixer": "^10.4.16"
    }
}

with open('/home/user/app/package.json', 'w') as f:
    json.dump(package_json, f, indent=2)
print('✓ package.json')

# Vite config for E2B - with allowedHosts
vite_config = """import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// E2B-compatible Vite configuration
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: false,
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1']
  }
})"""

with open('/home/user/app/vite.config.js', 'w') as f:
    f.write(vite_config)
print('✓ vite.config.js')

# Tailwind config - standard without custom design tokens
tailwind_config = """/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}"""

with open('/home/user/app/tailwind.config.js', 'w') as f:
    f.write(tailwind_config)
print('✓ tailwind.config.js')

# PostCSS config
postcss_config = """export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}"""

with open('/home/user/app/postcss.config.js', 'w') as f:
    f.write(postcss_config)
print('✓ postcss.config.js')

# Index.html
index_html = """<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sandbox App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>"""

with open('/home/user/app/index.html', 'w') as f:
    f.write(index_html)
print('✓ index.html')

# Main.jsx
main_jsx = """import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)"""

with open('/home/user/app/src/main.jsx', 'w') as f:
    f.write(main_jsx)
print('✓ src/main.jsx')

# App.jsx with explicit Tailwind test
app_jsx = """function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
      <div className="text-center max-w-2xl">
        <p className="text-lg text-gray-400">
          Sandbox Ready<br/>
          Start building your React app with Vite and Tailwind CSS!
        </p>
      </div>
    </div>
  )
}

export default App"""

with open('/home/user/app/src/App.jsx', 'w') as f:
    f.write(app_jsx)
print('✓ src/App.jsx')

# Index.css with explicit Tailwind directives
index_css = """@tailwind base;
@tailwind components;
@tailwind utilities;

/* Force Tailwind to load */
@layer base {
  :root {
    font-synthesis: none;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    -webkit-text-size-adjust: 100%;
  }
  
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  background-color: rgb(17 24 39);
}"""

with open('/home/user/app/src/index.css', 'w') as f:
    f.write(index_css)
print('✓ src/index.css')

print('\\nAll files created successfully!')
`;

        // Execute the setup script
        await sandbox.runCode(setupScript);
        
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'progress',
          message: 'Installing npm dependencies...',
          step: 'install'
        })}\n\n`));
        
        // Install dependencies
        console.log('[create-ai-sandbox] Installing dependencies...');
        await sandbox.runCode(`
import subprocess
import sys

print('Installing npm packages...')
result = subprocess.run(
    ['npm', 'install'],
    cwd='/home/user/app',
    capture_output=True,
    text=True
)

if result.returncode == 0:
    print('✓ Dependencies installed successfully')
else:
    print(f'⚠ Warning: npm install had issues: {result.stderr}')
    # Continue anyway as it might still work
    `);
        
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'progress',
          message: 'Starting Vite dev server...',
          step: 'vite'
        })}\n\n`));
        
        // Start Vite dev server
        console.log('[create-ai-sandbox] Starting Vite dev server...');
        await sandbox.runCode(`
import subprocess
import os
import time

os.chdir('/home/user/app')

# Kill any existing Vite processes
subprocess.run(['pkill', '-f', 'vite'], capture_output=True)
time.sleep(1)

# Start Vite dev server
env = os.environ.copy()
env['FORCE_COLOR'] = '0'

process = subprocess.Popen(
    ['npm', 'run', 'dev'],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    env=env
)

print(f'✓ Vite dev server started with PID: {process.pid}')
print('Waiting for server to be ready...')
    `);
        
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'progress',
          message: 'Finalizing sandbox setup...',
          step: 'finalize'
        })}\n\n`));
        
        // Reduced wait time for faster API response
        await new Promise(resolve => setTimeout(resolve, 3000)); // Reduced from 7s to 3s
        
        console.log('[create-ai-sandbox] Vite startup delay reduced for faster response');

        // Store sandbox globally
        global.activeSandbox = sandbox;
        global.sandboxData = {
          sandboxId,
          url: `https://${host}`
        };
        
        // Set extended timeout on the sandbox instance if method available
        if (typeof sandbox.setTimeout === 'function') {
          sandbox.setTimeout(appConfig.e2b.timeoutMs);
          console.log(`[create-ai-sandbox] Set sandbox timeout to ${appConfig.e2b.timeoutMinutes} minutes`);
        }
        
        // Initialize sandbox state
        global.sandboxState = {
          fileCache: {
            files: {},
            lastSync: Date.now(),
            sandboxId
          },
          sandbox,
          sandboxData: {
            sandboxId,
            url: `https://${host}`
          }
        };
        
        // Track initial files
        global.existingFiles.add('src/App.jsx');
        global.existingFiles.add('src/main.jsx');
        global.existingFiles.add('src/index.css');
        global.existingFiles.add('index.html');
        global.existingFiles.add('package.json');
        global.existingFiles.add('vite.config.js');
        global.existingFiles.add('tailwind.config.js');
        global.existingFiles.add('postcss.config.js');
        
        console.log('[create-ai-sandbox] Sandbox ready at:', `https://${host}`);
        
        // Send final success response
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'complete',
          success: true,
          sandboxId,
          url: `https://${host}`,
          message: 'Sandbox created and Vite React app initialized'
        })}\n\n`));
        
      } catch (error) {
        console.error('[create-ai-sandbox] Error:', error);
        
        // Send error response
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Failed to create sandbox',
          details: error instanceof Error ? error.stack : undefined
        })}\n\n`));
        
        // Clean up on error
        if (sandbox) {
          try {
            await sandbox.kill();
          } catch (e) {
            console.error('Failed to close sandbox on error:', e);
          }
        }
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}