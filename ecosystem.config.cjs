const path = require('node:path');

const rootDir = __dirname;

function getBunTargetDir() {
    const platformMap = {
        darwin: 'darwin',
        linux: 'linux',
        win32: 'windows',
    };
    const archMap = {
        arm64: 'arm64',
        x64: 'x64',
    };

    const platform = platformMap[process.platform];
    const arch = archMap[process.arch];

    if (!platform || !arch) {
        throw new Error(`Unsupported platform/arch for ecosystem config: ${process.platform}/${process.arch}`);
    }

    return `bun-${platform}-${arch}`;
}

module.exports = {
    apps: [
        {
            name: 'hapi-hub',
            cwd: rootDir,
            script: path.join(rootDir, 'cli', 'dist-exe', getBunTargetDir(), 'hapi'),
            args: 'hub --no-relay',
            interpreter: 'none',
            autorestart: true,
            watch: false,
            merge_logs: true,
            env: {
                HAPI_LISTEN_HOST: '127.0.0.1',
                HAPI_LISTEN_PORT: '3006',
                HAPI_PUBLIC_URL: 'https://hapi.mystery-vr.com'
            }
        }
    ]
}
